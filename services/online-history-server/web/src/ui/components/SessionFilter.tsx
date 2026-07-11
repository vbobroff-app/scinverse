import { useEffect, useRef, useState } from 'react';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { CalendarIcon, ClockIcon } from './icons';
import styles from './SessionFilter.module.css';

/** Дни недели в человекочитаемом порядке (Пн..Вс), значение — dow (0=вс..6=сб). */
const WEEKDAYS: { dow: number; label: string }[] = [
  { dow: 1, label: 'Пн' },
  { dow: 2, label: 'Вт' },
  { dow: 3, label: 'Ср' },
  { dow: 4, label: 'Чт' },
  { dow: 5, label: 'Пт' },
  { dow: 6, label: 'Сб' },
  { dow: 0, label: 'Вс' },
];

const DAY_PRESETS: { id: string; label: string; days: number[] }[] = [
  { id: 'all', label: 'Все', days: [0, 1, 2, 3, 4, 5, 6] },
  { id: 'week', label: 'Будни', days: [1, 2, 3, 4, 5] },
  { id: 'weekend', label: 'Сб, Вс', days: [6, 0] },
];

function minToHhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function hhmmToMin(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function sameDays(a: ReadonlySet<number>, days: number[]): boolean {
  return a.size === days.length && days.every((d) => a.has(d));
}

/**
 * Тайм-лайн-фильтр `[+]` в футере: дни (недели + торговый календарь биржи),
 * окно показа внутри дня (полные сутки / сессия биржи / расписание) и стандарт времени.
 * Меняет клиентскую проекцию оси Ганта; календари и history — плейсхолдеры под phase 7c.
 */
export function SessionFilter() {
  const store = useOhsStore();
  const filter = useBehavior(store.timelineFilter$);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const dw = filter.dayWindow;
  const isAllDays = filter.weekdays.size === 7;
  const active = dw.mode !== 'full' || !isAllDays;

  const toggleDay = (dow: number) => {
    const next = new Set(filter.weekdays);
    if (next.has(dow)) {
      if (next.size > 1) {
        next.delete(dow);
      }
    } else {
      next.add(dow);
    }
    store.setTimelineFilter({ weekdays: next });
  };

  const setCustomWindow = () => {
    const fromMin = dw.mode === 'custom' ? dw.fromMin : 10 * 60;
    const toMin = dw.mode === 'custom' ? dw.toMin : 19 * 60;
    store.setTimelineFilter({ dayWindow: { mode: 'custom', fromMin, toMin } });
  };

  const patchCustom = (patch: { fromMin?: number; toMin?: number }) => {
    if (dw.mode !== 'custom') {
      return;
    }
    store.setTimelineFilter({ dayWindow: { ...dw, ...patch } });
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={[styles.trigger, active ? styles.triggerActive : ''].filter(Boolean).join(' ')}
        onClick={() => setOpen((o) => !o)}
        title="Фильтр оси: дни, окно дня, стандарт времени"
        aria-label="Тайм-лайн-фильтр"
        aria-expanded={open}
      >
        +
      </button>

      {open && (
        <div className={styles.popover}>
          {/* --- Дни --- */}
          <div className={styles.section}>
            <span className={styles.sectionTitle}>Дни</span>
            <div className={styles.presets}>
              {DAY_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={[styles.preset, sameDays(filter.weekdays, p.days) ? styles.presetActive : '']
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => store.setTimelineFilter({ weekdays: new Set(p.days) })}
                >
                  {p.label}
                </button>
              ))}
              <span className={styles.divider} />
              <button
                type="button"
                className={styles.preset}
                disabled
                title="Торговый календарь MOEX (будни − праздники + разовые торги) — phase 7c"
              >
                <CalendarIcon className={styles.chipIcon} />MOEX
              </button>
              <button
                type="button"
                className={styles.preset}
                disabled
                title="Торговый календарь CME — при подключении зарубежных площадок"
              >
                <CalendarIcon className={styles.chipIcon} />CME
              </button>
            </div>
            <div className={styles.days}>
              {WEEKDAYS.map((w) => (
                <button
                  key={w.dow}
                  type="button"
                  className={[styles.day, filter.weekdays.has(w.dow) ? styles.dayOn : '']
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => toggleDay(w.dow)}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          {/* --- Окно дня --- */}
          <div className={styles.section}>
            <span className={styles.sectionTitle}>Окно дня</span>
            <div className={styles.chips}>
              <button
                type="button"
                className={[styles.chip, dw.mode === 'full' ? styles.chipOn : ''].filter(Boolean).join(' ')}
                onClick={() => store.setTimelineFilter({ dayWindow: { mode: 'full' } })}
                title="Полные сутки 00:00–24:00 (кросс-биржевой режим)"
              >
                Full
              </button>
              <button
                type="button"
                className={[styles.chip, dw.mode === 'session' && dw.exchange === 'MOEX' ? styles.chipOn : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => store.setTimelineFilter({ dayWindow: { mode: 'session', exchange: 'MOEX' } })}
                title="Сессия MOEX по сегодняшнему расписанию, спроецирована на историю"
              >
                <ClockIcon className={styles.chipIcon} />moex
              </button>
              <button
                type="button"
                className={styles.chip}
                disabled
                title="Сессия CME — при подключении площадки"
              >
                <ClockIcon className={styles.chipIcon} />cme
              </button>
            </div>

            <div className={styles.chips}>
              <button
                type="button"
                className={[styles.chip, dw.mode === 'custom' ? styles.chipOn : ''].filter(Boolean).join(' ')}
                onClick={setCustomWindow}
                title="Пользовательское окно t1–t2"
              >
                Расписание
              </button>
              <button
                type="button"
                className={[styles.chip, dw.mode === 'smart' ? styles.chipOn : ''].filter(Boolean).join(' ')}
                onClick={() => store.setTimelineFilter({ dayWindow: { mode: 'smart' } })}
                title="Авто: одна биржа в выборке → её сессия, микс → полные сутки. Ниже — дат-точные расписания."
              >
                Smart
              </button>
            </div>

            {dw.mode === 'custom' && (
              <div className={styles.timeRow}>
                <input
                  type="time"
                  className={styles.time}
                  value={minToHhmm(dw.fromMin)}
                  onChange={(e) => patchCustom({ fromMin: hhmmToMin(e.target.value) })}
                />
                <span className={styles.dash}>—</span>
                <input
                  type="time"
                  className={styles.time}
                  value={minToHhmm(dw.toMin)}
                  onChange={(e) => patchCustom({ toMin: hhmmToMin(e.target.value) })}
                />
              </div>
            )}

            {dw.mode === 'smart' && (
              <div className={styles.chips}>
                <button type="button" className={styles.chipMuted} disabled title="Дат-точное расписание MOEX из ISS — phase 7c">
                  MOEX history
                </button>
                <button type="button" className={styles.chipMuted} disabled title="Дат-точное расписание CME — позже">
                  CME history
                </button>
                <button type="button" className={styles.chipMuted} disabled title="Задать своё именованное расписание — позже">
                  Set schedule
                </button>
              </div>
            )}
          </div>

          <div className={styles.footer}>
            <button type="button" className={styles.reset} onClick={() => store.resetTimelineFilter()} disabled={!active}>
              Сбросить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
