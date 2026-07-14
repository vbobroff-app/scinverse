import { useEffect, useMemo, useState } from 'react';
import { OhsApi } from '../../core/api';
import type {
  MarketScheduleDto,
  MarketScheduleExceptionDto,
  ScheduleConfidence,
  ScheduleExceptionKind,
  SchedulePhaseDto,
} from '../../core/types';
import styles from './ExchangeSchedule.module.css';

/** Рынки с курируемым базовым расписанием (переключатель вверху вкладки). id = код market в БД. */
const ENGINES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'derivatives', label: 'Срочный (FORTS)' },
  { id: 'stock', label: 'Фондовый' },
  { id: 'currency', label: 'Валютный' },
];

type ScopeChip = { id: string; label: string };

/**
 * Пер-рыночные таксономии scope (`sec_type` → «Вид», `category` → «Категория»). Коды совпадают
 * с моделью scope в БД (см. docs/dev/phase7i/schedule.md); `category` для срочного рынка — как в
 * `futures_asset_class`. Пока это только навигация: собственного расписания у видов/категорий нет,
 * везде действует общий распорядок рынка — своё появится после резолва обобщённого исключения.
 */
const MARKET_TAXONOMY: Record<string, { secTypes: ScopeChip[]; categories: ScopeChip[] }> = {
  derivatives: {
    secTypes: [
      { id: 'futures', label: 'Фьючерсы' },
      { id: 'options', label: 'Опционы' },
      { id: 'spreads', label: 'Спреды' },
    ],
    categories: [
      { id: 'currency', label: 'Валюта' },
      { id: 'shares', label: 'Акции' },
      { id: 'index', label: 'Индексы' },
      { id: 'commodity', label: 'Товары' },
      { id: 'rate', label: 'Ставки' },
    ],
  },
  stock: {
    secTypes: [
      { id: 'shares', label: 'Акции' },
      { id: 'bonds', label: 'Облигации' },
      { id: 'etf', label: 'Фонды' },
      { id: 'dr', label: 'Расписки' },
    ],
    categories: [
      { id: 'ordinary', label: 'Обыкновенные' },
      { id: 'preferred', label: 'Привилегированные' },
    ],
  },
  currency: {
    secTypes: [
      { id: 'spot', label: 'Спот' },
      { id: 'swap', label: 'Свопы' },
    ],
    categories: [
      { id: 'tod', label: 'TOD' },
      { id: 'tom', label: 'TOM' },
    ],
  },
};

/** Человекочитаемые имена фаз (ключи совпадают с JSONB `phases`). */
const PHASE_LABELS: Record<string, string> = {
  auction: 'Аукцион открытия',
  morning: 'Утренняя сессия',
  main: 'Основная сессия',
  evening: 'Вечерняя сессия',
  weekend: 'Сессия выходного дня',
};

/** Подпись достоверности версии. */
const CONFIDENCE_LABELS: Record<ScheduleConfidence, string> = {
  authoritative: 'официальный источник (MOEX)',
  empirical: 'реконструкция (эмпирически)',
  assumed: 'предположение',
};

/** Короткая подпись достоверности (для таблицы исключений). */
const CONFIDENCE_SHORT: Record<ScheduleConfidence, string> = {
  authoritative: 'официальный',
  empirical: 'эмпирически',
  assumed: 'предположение',
};

/** Тип отклонения исключения. */
const KIND_LABELS: Record<ScheduleExceptionKind, string> = {
  no_trade: 'Нет торгов',
  shifted: 'Сдвиг сессии',
  shortened: 'Сокращённый день',
};

type DayKind = 'weekday' | 'weekend';

/** `HH:mm:ss` → `HH:mm`. */
function hhmm(time: string): string {
  return time.slice(0, 5);
}

/** `HH:mm[:ss]` → минуты от полуночи (для пропорциональной ширины сегментов). */
function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Длительность фазы в минутах (минимум 1, чтобы очень короткий аукцион остался видимым). */
function span(phase: SchedulePhaseDto): number {
  return Math.max(1, toMinutes(phase.till) - toMinutes(phase.from));
}

/**
 * Вкладка «Расписание» раздела «Биржи → Структура MOEX»: действующий торговый распорядок движка
 * из курируемой таблицы `market_schedule` (через бэкенд, без ISS). Переключатели Будни/Выходные,
 * пропорциональная лента фаз с часами (МСК) и подпись достоверности/источника версии.
 */
export function ExchangeSchedule() {
  const [engine, setEngine] = useState('derivatives');
  const [secType, setSecType] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [tab, setTab] = useState<DayKind>('weekday');
  const [schedule, setSchedule] = useState<MarketScheduleDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exceptions, setExceptions] = useState<MarketScheduleExceptionDto[]>([]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const sub = OhsApi.getMarketSchedule(engine).subscribe({
      next: (dto) => {
        setSchedule(dto);
        setLoading(false);
      },
      error: () => {
        setError('Для этого рынка расписание пока не заведено');
        setSchedule(null);
        setLoading(false);
      },
    });
    return () => sub.unsubscribe();
  }, [engine]);

  // Незарезолвенные исключения по датам для выбранного рынка (пока таблица обычно пуста).
  useEffect(() => {
    const sub = OhsApi.getScheduleExceptions(engine, true).subscribe({
      next: setExceptions,
      error: () => setExceptions([]),
    });
    return () => sub.unsubscribe();
  }, [engine]);

  const taxonomy = MARKET_TAXONOMY[engine] ?? { secTypes: [], categories: [] };
  const scopeSelected = secType !== null || category !== null;

  function selectMarket(id: string): void {
    setEngine(id);
    setSecType(null);
    setCategory(null);
  }

  /** Читаемая область действия исключения: «Рынок · Вид · Категория · SECID» (коды → русские подписи). */
  function scopeText(exc: MarketScheduleExceptionDto): string {
    const tax = MARKET_TAXONOMY[exc.market];
    const parts = [ENGINES.find((e) => e.id === exc.market)?.label ?? exc.market];
    if (exc.secType) {
      parts.push(tax?.secTypes.find((t) => t.id === exc.secType)?.label ?? exc.secType);
    }
    if (exc.category) {
      parts.push(tax?.categories.find((c) => c.id === exc.category)?.label ?? exc.category);
    }
    if (exc.instrument) {
      parts.push(exc.instrument);
    }
    return parts.join(' · ');
  }

  /** Окно исключения (МСК) или «—», если торгов нет / окно не задано. */
  function excWindow(exc: MarketScheduleExceptionDto): string {
    return exc.openTime && exc.closeTime ? `${hhmm(exc.openTime)} – ${hhmm(exc.closeTime)}` : '—';
  }

  const hasWeekend = !!(schedule?.weOpen && schedule?.weClose);

  // Если выбраны «Выходные», а рынок в выходные не торгует — откатываемся на «Будни».
  const activeTab: DayKind = tab === 'weekend' && !hasWeekend ? 'weekday' : tab;

  const phases = activeTab === 'weekday' ? schedule?.weekday ?? [] : schedule?.weekend ?? [];

  const outer = useMemo(() => {
    if (!schedule) {
      return null;
    }
    if (activeTab === 'weekday') {
      return { open: schedule.wdOpen, close: schedule.wdClose };
    }
    return schedule.weOpen && schedule.weClose
      ? { open: schedule.weOpen, close: schedule.weClose }
      : null;
  }, [schedule, activeTab]);

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div className={styles.engines} role="tablist" aria-label="Рынок">
          {ENGINES.map((e) => (
            <button
              key={e.id}
              className={[styles.engineBtn, engine === e.id ? styles.engineBtnActive : ''].filter(Boolean).join(' ')}
              onClick={() => selectMarket(e.id)}
            >
              {e.label}
            </button>
          ))}
        </div>
        <span className={styles.tz}>Время торгов — московское (GMT +3)</span>
      </div>

      <div className={styles.scope}>
        <span className={styles.scopeLabel}>Вид</span>
        {taxonomy.secTypes.map((t) => (
          <button
            key={t.id}
            className={[styles.chip, secType === t.id ? styles.chipActive : ''].filter(Boolean).join(' ')}
            onClick={() => setSecType((prev) => (prev === t.id ? null : t.id))}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={styles.scope}>
        <span className={styles.scopeLabel}>Категория</span>
        {taxonomy.categories.map((c) => (
          <button
            key={c.id}
            className={[styles.chip, category === c.id ? styles.chipActive : ''].filter(Boolean).join(' ')}
            onClick={() => setCategory((prev) => (prev === c.id ? null : c.id))}
          >
            {c.label}
          </button>
        ))}
      </div>

      {scopeSelected && (
        <div className={styles.scopeHint}>
          Собственного расписания для выбранного scope пока нет — действует общий распорядок рынка.
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}
      {loading && <div className={styles.hint}>Загрузка расписания…</div>}

      {!loading && !error && schedule && (
        <>
          <div className={styles.dayTabs} role="tablist" aria-label="Тип дня">
            <button
              role="tab"
              aria-selected={activeTab === 'weekday'}
              className={[styles.dayTab, activeTab === 'weekday' ? styles.dayTabActive : ''].filter(Boolean).join(' ')}
              onClick={() => setTab('weekday')}
            >
              Будние дни
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'weekend'}
              className={[styles.dayTab, activeTab === 'weekend' ? styles.dayTabActive : ''].filter(Boolean).join(' ')}
              onClick={() => setTab('weekend')}
              disabled={!hasWeekend}
              title={hasWeekend ? undefined : 'В выходные дни не торгуется'}
            >
              Выходные дни
            </button>
            {outer && (
              <span className={styles.outer}>
                {hhmm(outer.open)} – {hhmm(outer.close)}
              </span>
            )}
          </div>

          {phases.length === 0 ? (
            <div className={styles.hint}>
              {activeTab === 'weekend' ? 'В выходные дни торги не проводятся.' : 'Фазы не заданы для этой версии.'}
            </div>
          ) : (
            <>
              <div className={styles.timeline}>
                {phases.map((p) => (
                  <div
                    key={p.key}
                    className={[styles.segment, styles[p.key] ?? ''].filter(Boolean).join(' ')}
                    style={{ flexGrow: span(p) }}
                  >
                    <span className={styles.segTime}>
                      {hhmm(p.from)} – {hhmm(p.till)}
                    </span>
                    <span className={styles.segLabel}>{PHASE_LABELS[p.key] ?? p.key}</span>
                  </div>
                ))}
              </div>

              <ul className={styles.phaseList}>
                {phases.map((p) => (
                  <li key={p.key} className={styles.phaseItem}>
                    <span className={[styles.swatch, styles[p.key] ?? ''].filter(Boolean).join(' ')} />
                    <span className={styles.phaseName}>{PHASE_LABELS[p.key] ?? p.key}</span>
                    <span className={styles.phaseTime}>
                      {hhmm(p.from)} – {hhmm(p.till)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className={styles.meta}>
            <span className={[styles.badge, styles[`c_${schedule.confidence}`] ?? ''].filter(Boolean).join(' ')}>
              {CONFIDENCE_LABELS[schedule.confidence]}
            </span>
            <span className={styles.metaText}>
              действует с {schedule.effectiveFrom}
              {schedule.source ? ` · источник: ${schedule.source}` : ''}
            </span>
            {schedule.note && <span className={styles.note}>{schedule.note}</span>}
          </div>
        </>
      )}

      <div className={styles.exceptions}>
        <div className={styles.exceptionsHead}>
          <span className={styles.exceptionsTitle}>Исключения (неразобранные)</span>
          {exceptions.length > 0 && <span className={styles.exceptionsCount}>{exceptions.length}</span>}
        </div>

        {exceptions.length === 0 ? (
          <div className={styles.hint}>Исключения не найдены.</div>
        ) : (
          <table className={styles.excTable}>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Область</th>
                <th>Отклонение</th>
                <th>Время (МСК)</th>
                <th>Достоверность</th>
                <th>Источник</th>
                <th>Примечание</th>
              </tr>
            </thead>
            <tbody>
              {exceptions.map((exc, i) => (
                <tr key={`${exc.market}-${exc.instrument ?? ''}-${exc.excDate}-${i}`}>
                  <td className={styles.excDate}>{exc.excDate}</td>
                  <td>{scopeText(exc)}</td>
                  <td>{KIND_LABELS[exc.kind] ?? exc.kind}</td>
                  <td className={styles.excMono}>{excWindow(exc)}</td>
                  <td>{CONFIDENCE_SHORT[exc.confidence] ?? exc.confidence}</td>
                  <td>{exc.source ?? '—'}</td>
                  <td className={styles.excNote}>{exc.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
