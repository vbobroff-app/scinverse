import { useState } from 'react';
import { MONTHS_RU, MonthGrid } from './MonthGrid';
import styles from './DateRangePicker.module.css';

interface Props {
  from?: string;
  to?: string;
  onApply: (from: string, to: string) => void;
  /** Доп. действие при «Сбросить» (напр. закрыть поповер). */
  onReset?: () => void;
}

/**
 * Лёгкий календарь выбора диапазона дат (по мотивам Single Date Time из ui-kit,
 * без его зависимостей). Гранулярность — дни; окно снапается к границам сессий в сторе.
 * Раскладка месяца — общий {@link MonthGrid}; здесь только выбор диапазона и навигация.
 */
export function DateRangePicker({ from, to, onApply, onReset }: Props) {
  const today = new Date();
  const initial = from ? new Date(from) : today;

  const [view, setView] = useState({ year: initial.getFullYear(), month: initial.getMonth() });
  const [start, setStart] = useState<string | undefined>(from);
  const [end, setEnd] = useState<string | undefined>(to);

  const pick = (value: string) => {
    // Двухшаговый выбор: первый клик — start, второй — end (с авто-упорядочиванием).
    if (!start || (start && end)) {
      setStart(value);
      setEnd(undefined);
      return;
    }
    if (value < start) {
      setEnd(start);
      setStart(value);
    } else {
      setEnd(value);
    }
  };

  const shiftMonth = (delta: number) => {
    const base = new Date(view.year, view.month + delta, 1);
    setView({ year: base.getFullYear(), month: base.getMonth() });
  };

  const goToday = () => setView({ year: today.getFullYear(), month: today.getMonth() });
  // «Сбросить»: очищаем выбор и уведомляем родителя (напр. закрыть календарь).
  const reset = () => {
    setStart(undefined);
    setEnd(undefined);
    onReset?.();
  };

  const apply = () => {
    if (start) {
      onApply(start, end ?? start);
    }
  };

  const inRange = (value: string) =>
    start !== undefined && end !== undefined && value >= start && value <= end;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <button type="button" className={styles.link} onClick={reset} tabIndex={-1}>
          Сбросить
        </button>
        <button type="button" className={styles.link} onClick={goToday} tabIndex={-1}>
          Сегодня
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
        renderDay={(value) => (
          <button
            key={value}
            type="button"
            className={[
              styles.cell,
              value === start || value === end ? styles.cellEdge : '',
              inRange(value) ? styles.cellInRange : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => pick(value)}
          >
            {Number(value.slice(8))}
          </button>
        )}
      />

      <div className={styles.footer}>
        <span className={styles.selection}>
          {start ? `${start.slice(8)}.${start.slice(5, 7)}` : '—'}
          {' – '}
          {end ? `${end.slice(8)}.${end.slice(5, 7)}` : start ? `${start.slice(8)}.${start.slice(5, 7)}` : '—'}
        </span>
        <button type="button" className={styles.apply} onClick={apply} disabled={!start}>
          Применить
        </button>
      </div>
    </div>
  );
}
