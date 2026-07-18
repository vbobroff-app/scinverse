import { useEffect, useState } from 'react';
import type { ConnectionScheduleDto, PutConnectionScheduleRequest } from '../../core/types';
import { OhsApi } from '../../core/api';
import styles from './ConnectionSchedulePopover.module.css';

interface Props {
  connectionId: number;
  current: ConnectionScheduleDto | undefined;
  open: boolean;
  onClose: () => void;
  onPublish: (body: PutConnectionScheduleRequest) => void;
}

/** Упрощённый popover расписания Connection (phase 7j): окно + пресеты ±N + история. */
export function ConnectionSchedulePopover({ connectionId, current, open, onClose, onPublish }: Props) {
  const [start, setStart] = useState('06:00');
  const [end, setEnd] = useState('01:00');
  const [engine, setEngine] = useState('futures');
  const [padHours, setPadHours] = useState(1);
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<ConnectionScheduleDto[]>([]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (current) {
      setStart(current.windowStart.slice(0, 5));
      setEnd(current.windowEnd.slice(0, 5));
      setEngine(current.engine);
    }
    OhsApi.getConnectionScheduleHistory(connectionId).subscribe({
      next: setHistory,
      error: () => setHistory([]),
    });
  }, [open, connectionId, current]);

  if (!open) {
    return null;
  }

  const applyPreset = (presetEngine: string, openH: number, openM: number, closeH: number, closeM: number) => {
    const pad = Math.max(0, padHours);
    const openMin = openH * 60 + openM - pad * 60;
    const closeMin = closeH * 60 + closeM + pad * 60;
    setEngine(presetEngine);
    setStart(fmtMin(openMin));
    setEnd(fmtMin(closeMin));
  };

  const approve = () => {
    if (!window.confirm('Опубликовать новую версию расписания соединения?')) {
      return;
    }
    onPublish({
      mode: current?.mode ?? 'manual',
      windowStart: `${start}:00`,
      windowEnd: `${end}:00`,
      engine,
      tz: 'Europe/Moscow',
      changeSource: 'ui',
      changeNote: note.trim() || null,
    });
    onClose();
  };

  return (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Расписание соединения"
      >
        <header className={styles.head}>
          <strong>Расписание соединения</strong>
          <button type="button" className={styles.close} onClick={onClose}>
            ×
          </button>
        </header>

        <div className={styles.row}>
          <label>
            Open
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            Close
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>

        <div className={styles.presets}>
          <label>
            ± час
            <input
              type="number"
              min={0}
              max={6}
              value={padHours}
              onChange={(e) => setPadHours(Number(e.target.value) || 0)}
            />
          </label>
          <button type="button" onClick={() => applyPreset('futures', 7, 0, 24, 0)}>
            MOEX срочный ±
          </button>
          <button type="button" onClick={() => applyPreset('stock', 6, 50, 23, 50)}>
            MOEX фондовый ±
          </button>
          <button type="button" onClick={() => applyPreset('currency', 6, 50, 23, 50)}>
            MOEX валютный ±
          </button>
        </div>

        <label className={styles.note}>
          Комментарий
          <input
            type="text"
            value={note}
            placeholder="например: брокер рвёт до 07:00"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <button type="button" className={styles.approve} onClick={approve}>
          Утвердить
        </button>

        {history.length > 0 && (
          <section className={styles.history}>
            <h4>История</h4>
            <ul>
              {history.map((h) => (
                <li key={h.scheduleId}>
                  <span>
                    {h.windowStart.slice(0, 5)}–{h.windowEnd.slice(0, 5)} · {h.engine}
                  </span>
                  <span className={styles.meta}>
                    {new Date(h.effectiveFrom).toLocaleString('ru-RU')} · {h.changeSource}
                    {h.changeNote ? ` · ${h.changeNote}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

/** Минуты от полуночи (может выходить за сутки после ±N) → `HH:mm`, нормализуя через полночь. */
function fmtMin(total: number): string {
  const day = 24 * 60;
  const m = ((total % day) + day) % day;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
