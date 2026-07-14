import { useMemo, useState } from 'react';
import { OhsApi } from '../../core/api';
import { Button } from '../components/Button';
import { CollapsibleCard } from '../components/CollapsibleCard';
import type { ExternalScheduleDto, ExternalServiceDto } from '../../core/types';
import styles from './IntegrationWorkspace.module.css';

interface Props {
  service: ExternalServiceDto;
}

/** Быстрые примеры символов Finam (SECID@MIC). */
const SAMPLE_SYMBOLS = ['SBER@MISX', 'SiU6@RTSX', 'RIU6@RTSX', 'GAZP@MISX'];

/** Русские подписи типов сессий Finam. */
const SESSION_LABELS: Record<string, string> = {
  EARLY_TRADING: 'Утренняя',
  CORE_TRADING: 'Основная',
  LATE_TRADING: 'Вечерняя',
  OPENING_AUCTION: 'Аукцион открытия',
  CLOSING_AUCTION: 'Аукцион закрытия',
  CLEARING: 'Клиринг',
  CLOSED: 'Закрыто',
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

export function IntegrationWorkspace({ service }: Props) {
  const [probe, setProbe] = useState<ProbeState>({ kind: 'idle' });
  const [symbol, setSymbol] = useState('SBER@MISX');
  const [hideClosed, setHideClosed] = useState(true);
  const [sched, setSched] = useState<SchedState>({ kind: 'idle' });

  const runProbe = () => {
    setProbe({ kind: 'busy' });
    OhsApi.probeIntegration(service.serviceId).subscribe({
      next: (r) => setProbe({ kind: 'done', ok: r.ok, message: r.message }),
      error: () => setProbe({ kind: 'done', ok: false, message: 'Проверка не удалась' }),
    });
  };

  const runSchedule = () => {
    if (!symbol.trim()) {
      return;
    }
    setSched({ kind: 'busy' });
    OhsApi.getIntegrationSchedule(service.serviceId, symbol.trim()).subscribe({
      next: (data) => setSched({ kind: 'done', data }),
      error: (e: unknown) => {
        const message =
          (e as { response?: { error?: string } } | null)?.response?.error ?? 'Не удалось получить расписание';
        setSched({ kind: 'error', message });
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
          <Button onClick={runProbe} disabled={probe.kind === 'busy' || !service.hasSecret}>
            {probe.kind === 'busy' ? 'Проверка…' : 'Проверить связь'}
          </Button>
          {probe.kind === 'done' && (
            <span className={probe.ok ? styles.probeOk : styles.probeFail}>{probe.message}</span>
          )}
        </div>
      </header>

      <CollapsibleCard title="Расписание инструмента" subtitle="AssetsService/Schedule" defaultOpen>
        <div className={styles.request}>
          <input
            className={styles.input}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="SECID@MIC, напр. SBER@MISX"
            onKeyDown={(e) => e.key === 'Enter' && runSchedule()}
          />
          <Button variant="primary" onClick={runSchedule} disabled={sched.kind === 'busy'}>
            {sched.kind === 'busy' ? 'Запрос…' : 'Запросить'}
          </Button>
        </div>
        <div className={styles.samples}>
          {SAMPLE_SYMBOLS.map((s) => (
            <button key={s} className={styles.sample} onClick={() => setSymbol(s)}>
              {s}
            </button>
          ))}
        </div>

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
    </section>
  );
}
