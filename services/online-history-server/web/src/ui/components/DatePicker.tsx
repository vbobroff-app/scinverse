import { useState } from 'react';
import { MONTHS_RU, MonthGrid } from './MonthGrid';
import { CalendarIcon } from './icons';
import styles from './DatePicker.module.css';

interface Props {
  /** Выбранная дата ISO `yyyy-MM-dd` или null. */
  value?: string | null;
  onChange: (iso: string | null) => void;
  placeholder?: string;
}

/**
 * Пикер одной даты (парный к {@link DateRangePicker}) на общей раскладке {@link MonthGrid}.
 * Триггер-поле открывает поповер с навигацией по месяцам; клик по дню выбирает и закрывает.
 */
export function DatePicker({ value, onChange, placeholder = 'Не задано' }: Props) {
  const [open, setOpen] = useState(false);
  const today = new Date();
  const initial = value ? new Date(value) : today;
  const [view, setView] = useState({ year: initial.getFullYear(), month: initial.getMonth() });

  const shiftMonth = (delta: number) => {
    const base = new Date(view.year, view.month + delta, 1);
    setView({ year: base.getFullYear(), month: base.getMonth() });
  };

  const display = value ? `${value.slice(8)}.${value.slice(5, 7)}.${value.slice(0, 4)}` : placeholder;

  return (
    <div className={styles.wrap}>
      <div className={styles.field}>
        <button type="button" className={styles.trigger} onClick={() => setOpen((v) => !v)}>
          <CalendarIcon className={styles.icon} />
          <span className={value ? styles.value : styles.placeholder}>{display}</span>
        </button>
        {value && (
          <button
            type="button"
            className={styles.clear}
            onClick={() => onChange(null)}
            aria-label="Очистить дату"
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <>
          <div className={styles.backdrop} onClick={() => setOpen(false)} />
          <div className={styles.pop}>
            <div className={styles.header}>
              <button
                type="button"
                className={styles.link}
                onClick={() => setView({ year: today.getFullYear(), month: today.getMonth() })}
                tabIndex={-1}
              >
                Сегодня
              </button>
              <button
                type="button"
                className={styles.link}
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                tabIndex={-1}
              >
                Очистить
              </button>
            </div>

            <div className={styles.nav}>
              <button type="button" className={styles.navBtn} onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц">
                ‹
              </button>
              <span className={styles.navTitle}>
                {MONTHS_RU[view.month]} {view.year}
              </span>
              <button type="button" className={styles.navBtn} onClick={() => shiftMonth(1)} aria-label="Следующий месяц">
                ›
              </button>
            </div>

            <MonthGrid
              year={view.year}
              month={view.month}
              classes={{ weekdays: styles.weekdays, weekday: styles.weekday, grid: styles.cells, empty: styles.empty }}
              renderDay={(iso) => (
                <button
                  key={iso}
                  type="button"
                  className={[styles.cell, iso === value ? styles.cellEdge : ''].filter(Boolean).join(' ')}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                >
                  {Number(iso.slice(8))}
                </button>
              )}
            />
          </div>
        </>
      )}
    </div>
  );
}
