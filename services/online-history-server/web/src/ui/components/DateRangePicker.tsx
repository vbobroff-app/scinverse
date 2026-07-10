import { useMemo, useState } from 'react';
import styles from './DateRangePicker.module.css';

interface Props {
  from?: string;
  to?: string;
  onApply: (from: string, to: string) => void;
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

/** ISO `yyyy-MM-dd` из компонентов даты. */
function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Пн=0..Вс=6 для первого дня месяца. */
function firstWeekdayMonFirst(y: number, m: number): number {
  return (new Date(y, m, 1).getDay() + 6) % 7;
}

/**
 * Лёгкий календарь выбора диапазона дат (по мотивам Single Date Time из ui-kit,
 * без его зависимостей). Гранулярность — дни; окно снапается к границам сессий в сторе.
 */
export function DateRangePicker({ from, to, onApply }: Props) {
  const today = new Date();
  const initial = from ? new Date(from) : today;

  const [view, setView] = useState({ year: initial.getFullYear(), month: initial.getMonth() });
  const [start, setStart] = useState<string | undefined>(from);
  const [end, setEnd] = useState<string | undefined>(to);

  const grid = useMemo(() => {
    const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
    const lead = firstWeekdayMonFirst(view.year, view.month);
    const cells: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(iso(view.year, view.month, d));
    }
    return cells;
  }, [view]);

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
  const reset = () => {
    setStart(undefined);
    setEnd(undefined);
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
          {MONTHS[view.month]} {view.year}
        </span>
        <button type="button" className={styles.navBtn} onClick={() => shiftMonth(1)} aria-label="Следующий месяц">
          ›
        </button>
      </div>

      <div className={styles.weekdays}>
        {WEEKDAYS.map((w) => (
          <span key={w} className={styles.weekday}>
            {w}
          </span>
        ))}
      </div>

      <div className={styles.cells}>
        {grid.map((value, i) =>
          value === null ? (
            <span key={`e${i}`} className={styles.empty} />
          ) : (
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
          ),
        )}
      </div>

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
