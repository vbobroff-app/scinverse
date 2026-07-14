import { useEffect, useMemo, useState } from 'react';
import { OhsApi } from '../../core/api';
import type { MarketScheduleDto, ScheduleConfidence, SchedulePhaseDto } from '../../core/types';
import styles from './ExchangeSchedule.module.css';

/** Рынки с курируемым базовым расписанием (переключатель вверху вкладки). id = код market в БД. */
const ENGINES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'derivatives', label: 'Срочный (FORTS)' },
  { id: 'stock', label: 'Фондовый' },
  { id: 'currency', label: 'Валютный' },
];

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
  const [tab, setTab] = useState<DayKind>('weekday');
  const [schedule, setSchedule] = useState<MarketScheduleDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <div className={styles.engines} role="tablist" aria-label="Движок">
          {ENGINES.map((e) => (
            <button
              key={e.id}
              className={[styles.engineBtn, engine === e.id ? styles.engineBtnActive : ''].filter(Boolean).join(' ')}
              onClick={() => setEngine(e.id)}
            >
              {e.label}
            </button>
          ))}
        </div>
        <span className={styles.tz}>Время торгов — московское (GMT +3)</span>
      </div>

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
    </div>
  );
}
