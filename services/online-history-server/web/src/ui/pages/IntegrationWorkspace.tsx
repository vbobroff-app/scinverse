import { useMemo, useState } from 'react';
import { OhsApi } from '../../core/api';
import { Button } from '../components/Button';
import { CollapsibleCard } from '../components/CollapsibleCard';
import type { ExternalCalendarDto, ExternalScheduleDto, ExternalServiceDto } from '../../core/types';
import styles from './IntegrationWorkspace.module.css';

interface Props {
  service: ExternalServiceDto;
  /** Перезагрузить список сервисов (после смены источника системного расписания). */
  onChanged?: () => void;
}

/** Быстрые примеры символов Finam (SECID@MIC). */
const SAMPLE_SYMBOLS = ['SBER@MISX', 'SiU6@RTSX', 'RIU6@RTSX', 'GAZP@MISX'];

/** Движки ISS для session_schedule (market-wide). */
const ISS_ENGINES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'futures', label: 'Срочный (futures)' },
  { id: 'stock', label: 'Фондовый (stock)' },
  { id: 'currency', label: 'Валютный (currency)' },
];

/** Адаптеры, умеющие расписание (capability «schedule»). */
const SCHEDULE_CAPABLE_ADAPTERS = ['finam', 'moex-iss'];

/** Адаптеры, умеющие торговый календарь (capability «calendar»). */
const CALENDAR_CAPABLE_ADAPTERS = ['moex-iss'];

/** ISO-дата (yyyy-MM-dd) → dd.MM.yyyy. */
const fmtDay = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

/** TimeOnly (HH:mm:ss|null) → HH:mm|«—». */
const fmtHour = (t: string | null): string => (t ? t.slice(0, 5) : '—');

/** Русские подписи типов сессий: Finam (UPPER) + MOEX ISS (lower). */
const SESSION_LABELS: Record<string, string> = {
  EARLY_TRADING: 'Утренняя',
  CORE_TRADING: 'Основная',
  LATE_TRADING: 'Вечерняя',
  OPENING_AUCTION: 'Аукцион открытия',
  CLOSING_AUCTION: 'Аукцион закрытия',
  CLEARING: 'Клиринг',
  CLOSED: 'Закрыто',
  oa_booking: 'Аукцион открытия (сбор)',
  oa_pricing: 'Аукцион открытия (цена)',
  morning_session: 'Утренняя',
  main_session: 'Основная',
  evening_session: 'Вечерняя',
  weekend_session: 'Выходного дня',
  settlement_session: 'Расчётная',
  clearing_session: 'Клиринг',
};

const mskTime = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  hour: '2-digit',
  minute: '2-digit',
});
const mskDate = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
});

type ProbeState = { kind: 'idle' | 'busy' } | { kind: 'done'; ok: boolean; message: string };
type SchedState =
  | { kind: 'idle' | 'busy' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; data: ExternalScheduleDto };
type CalState =
  | { kind: 'idle' | 'busy' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; data: ExternalCalendarDto };

export function IntegrationWorkspace({ service, onChanged }: Props) {
  const adapter = service.adapter.toLowerCase();
  const isIss = adapter === 'moex-iss';

  const [probe, setProbe] = useState<ProbeState>({ kind: 'idle' });
  const [symbol, setSymbol] = useState('SBER@MISX');
  const [engine, setEngine] = useState('futures');
  const [hideClosed, setHideClosed] = useState(true);
  const [sched, setSched] = useState<SchedState>({ kind: 'idle' });
  const [cal, setCal] = useState<CalState>({ kind: 'idle' });
  const [calOnlyEvents, setCalOnlyEvents] = useState(true);
  const [sourceBusy, setSourceBusy] = useState(false);

  // Расписание умеют оба адаптера (finam per-instrument, ISS market-wide) — capability «schedule».
  const scheduleCapable = SCHEDULE_CAPABLE_ADAPTERS.includes(adapter);
  const calendarCapable = CALENDAR_CAPABLE_ADAPTERS.includes(adapter);

  const toggleScheduleSource = (enabled: boolean) => {
    setSourceBusy(true);
    OhsApi.setScheduleSource(service.serviceId, enabled).subscribe({
      next: () => {
        setSourceBusy(false);
        onChanged?.();
      },
      error: () => setSourceBusy(false),
    });
  };

  const runProbe = () => {
    setProbe({ kind: 'busy' });
    OhsApi.probeIntegration(service.serviceId).subscribe({
      next: (r) => setProbe({ kind: 'done', ok: r.ok, message: r.message }),
      error: () => setProbe({ kind: 'done', ok: false, message: 'Проверка не удалась' }),
    });
  };

  const runSchedule = () => {
    const params = isIss ? { engine } : { symbol: symbol.trim() };
    if (!isIss && !symbol.trim()) {
      return;
    }
    setSched({ kind: 'busy' });
    OhsApi.getIntegrationSchedule(service.serviceId, params).subscribe({
      next: (data) => setSched({ kind: 'done', data }),
      error: (e: unknown) => {
        const message =
          (e as { response?: { error?: string } } | null)?.response?.error ?? 'Не удалось получить расписание';
        setSched({ kind: 'error', message });
      },
    });
  };

  const runCalendar = () => {
    setCal({ kind: 'busy' });
    OhsApi.getIntegrationCalendar(service.serviceId, { engine }).subscribe({
      next: (data) => setCal({ kind: 'done', data }),
      error: (e: unknown) => {
        const message =
          (e as { response?: { error?: string } } | null)?.response?.error ?? 'Не удалось получить календарь';
        setCal({ kind: 'error', message });
      },
    });
  };

  const rows = useMemo(() => {
    if (sched.kind !== 'done') {
      return [];
    }
    return [...sched.data.sessions]
      .filter((s) => !(hideClosed && s.type === 'CLOSED'))
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [sched, hideClosed]);

  const calRows = useMemo(() => {
    if (cal.kind !== 'done') {
      return [];
    }
    // По умолчанию показываем только «события»: нерабочие дни и явные исключения (dailytable).
    return cal.data.days.filter((d) => !calOnlyEvents || !d.isTradingDay || d.isException);
  }, [cal, calOnlyEvents]);

  return (
    <section className={styles.workspace}>
      <header className={styles.head}>
        <div>
          <h2 className={styles.name}>{service.name}</h2>
          <div className={styles.badges}>
            <span className={styles.badge}>{service.adapter}</span>
            <span className={styles.badge}>{service.transport}</span>
            <span className={[styles.badge, service.enabled ? styles.on : styles.off].join(' ')}>
              {service.enabled ? 'включена' : 'выключена'}
            </span>
            <span className={styles.badge}>{service.hasSecret ? 'секрет задан' : 'нет секрета'}</span>
            {service.secretExpiresOn && (
              <span className={styles.badge}>истекает {service.secretExpiresOn}</span>
            )}
          </div>
        </div>
        <div className={styles.probeBox}>
          <Button onClick={runProbe} disabled={probe.kind === 'busy' || (!isIss && !service.hasSecret)}>
            {probe.kind === 'busy' ? 'Проверка…' : 'Проверить связь'}
          </Button>
          {probe.kind === 'done' && (
            <span className={probe.ok ? styles.probeOk : styles.probeFail}>{probe.message}</span>
          )}
        </div>
      </header>

      <CollapsibleCard
        title="Расписание"
        subtitle={isIss ? 'ISS session_schedule (текущий день)' : 'AssetsService/Schedule'}
        defaultOpen
        right={
          scheduleCapable ? (
            <label
              className={styles.sourceToggle}
              title="Использовать это расписание как системный источник для авто-сверки"
            >
              <input
                type="checkbox"
                checked={service.useForSchedule}
                disabled={sourceBusy}
                onChange={(e) => toggleScheduleSource(e.target.checked)}
              />
              Использовать для системного расписания
            </label>
          ) : undefined
        }
      >
        <div className={styles.request}>
          {isIss ? (
            <select className={styles.input} value={engine} onChange={(e) => setEngine(e.target.value)}>
              {ISS_ENGINES.map((e) => (
                <option key={e.id} value={e.id}>{e.label}</option>
              ))}
            </select>
          ) : (
            <input
              className={styles.input}
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="SECID@MIC, напр. SBER@MISX"
              onKeyDown={(e) => e.key === 'Enter' && runSchedule()}
            />
          )}
          <Button variant="primary" onClick={runSchedule} disabled={sched.kind === 'busy'}>
            {sched.kind === 'busy' ? 'Запрос…' : 'Запросить'}
          </Button>
        </div>
        {!isIss && (
          <div className={styles.samples}>
            {SAMPLE_SYMBOLS.map((s) => (
              <button key={s} className={styles.sample} onClick={() => setSymbol(s)}>
                {s}
              </button>
            ))}
          </div>
        )}

        {sched.kind === 'error' && <div className={styles.error}>{sched.message}</div>}

        {sched.kind === 'done' && (
          <>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={hideClosed}
                onChange={(e) => setHideClosed(e.target.checked)}
              />
              Скрывать CLOSED · время МСК (GMT+3)
            </label>
            {rows.length === 0 ? (
              <div className={styles.hint}>Нет сессий для показа.</div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Сессия</th>
                      <th>Начало</th>
                      <th>Конец</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s, i) => (
                      <tr key={`${s.type}-${s.start}-${i}`} className={s.type === 'CLOSED' ? styles.closed : ''}>
                        <td>{mskDate.format(new Date(s.start))}</td>
                        <td>{SESSION_LABELS[s.type] ?? s.type}</td>
                        <td className={styles.mono}>{mskTime.format(new Date(s.start))}</td>
                        <td className={styles.mono}>{mskTime.format(new Date(s.end))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CollapsibleCard>

      {calendarCapable && (
        <CollapsibleCard title="Календарь (исключения)" subtitle="ISS dailytable · праздники/переносы">
          <div className={styles.request}>
            <select className={styles.input} value={engine} onChange={(e) => setEngine(e.target.value)}>
              {ISS_ENGINES.map((e) => (
                <option key={e.id} value={e.id}>{e.label}</option>
              ))}
            </select>
            <Button variant="primary" onClick={runCalendar} disabled={cal.kind === 'busy'}>
              {cal.kind === 'busy' ? 'Запрос…' : 'Запросить'}
            </Button>
          </div>

          {cal.kind === 'error' && <div className={styles.error}>{cal.message}</div>}

          {cal.kind === 'done' && (
            <>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={calOnlyEvents}
                  onChange={(e) => setCalOnlyEvents(e.target.checked)}
                />
                Только нерабочие дни и исключения
              </label>
              {calRows.length === 0 ? (
                <div className={styles.hint}>Нет событий в диапазоне (все дни — по обычному правилу недели).</div>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Дата</th>
                        <th>Статус</th>
                        <th>Открытие</th>
                        <th>Закрытие</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calRows.map((d) => (
                        <tr key={d.date} className={d.isTradingDay ? '' : styles.closed}>
                          <td>{fmtDay(d.date)}</td>
                          <td>
                            {d.isTradingDay ? 'Торгуется' : 'Не торгуется'}
                            {d.isException ? ' · исключение' : ''}
                          </td>
                          <td className={styles.mono}>{d.isTradingDay ? fmtHour(d.open) : '—'}</td>
                          <td className={styles.mono}>{d.isTradingDay ? fmtHour(d.close) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </CollapsibleCard>
      )}
    </section>
  );
}
