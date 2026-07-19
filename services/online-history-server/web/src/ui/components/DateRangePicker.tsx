import { useEffect, useState } from 'react';
import { MONTHS_RU, MonthGrid } from './MonthGrid';
import styles from './DateRangePicker.module.css';

export interface DateDayAppearance {
  /** Неторговый день — красный текст. */
  nonTrading?: boolean;
  /** Уже есть static-исключение — акцентная рамка. */
  hasException?: boolean;
}

interface Props {
  from?: string;
  to?: string;
  onApply: (from: string, to: string) => void;
  /** Доп. действие при «Сбросить» (напр. закрыть поповер). */
  onReset?: () => void;
  /** Макс. длина диапазона включительно (дней). */
  maxSpanDays?: number;
  /** Подсветка дней (неторговые / уже с исключением). */
  dayAppearance?: (iso: string) => DateDayAppearance;
  /** Смена видимого месяца (для подгрузки календаря). */
  onViewChange?: (year: number, month: number) => void;
  /** Подпись кнопки подтверждения (по умолчанию «Применить»). */
  applyLabel?: string;
}

function spanDays(a: string, b: string): number {
  const ms = Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`);
  return Math.round(ms / 86_400_000) + 1;
}

function addDaysIso(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Лёгкий календарь выбора диапазона дат (по мотивам Single Date Time из ui-kit,
 * без его зависимостей). Гранулярность — дни; окно снапается к границам сессий в сторе.
 * Раскладка месяца — общий {@link MonthGrid}; здесь только выбор диапазона и навигация.
 */
export function DateRangePicker({
  from,
  to,
  onApply,
  onReset,
  maxSpanDays,
  dayAppearance,
  onViewChange,
  applyLabel = 'Применить',
}: Props) {
  const today = new Date();
  const initial = from ? new Date(from) : today;

  const [view, setView] = useState({ year: initial.getFullYear(), month: initial.getMonth() });
  const [start, setStart] = useState<string | undefined>(from);
  const [end, setEnd] = useState<string | undefined>(to);
  const [spanError, setSpanError] = useState(false);

  useEffect(() => {
    onViewChange?.(view.year, view.month);
    // Только смена месяца — identity колбэка не важна.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onViewChange
  }, [view.year, view.month]);

  const pick = (value: string) => {
    setSpanError(false);
    // Двухшаговый выбор: первый клик — start, второй — end (с авто-упорядочиванием).
    if (!start || (start && end)) {
      setStart(value);
      setEnd(undefined);
      return;
    }
    let lo = value < start ? value : start;
    let hi = value < start ? start : value;
    if (maxSpanDays != null && spanDays(lo, hi) > maxSpanDays) {
      hi = addDaysIso(lo, maxSpanDays - 1);
      setSpanError(true);
    }
    setStart(lo);
    setEnd(hi);
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
    setSpanError(false);
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
        renderDay={(value) => {
          const look = dayAppearance?.(value);
          return (
            <button
              key={value}
              type="button"
              className={[
                styles.cell,
                value === start || value === end ? styles.cellEdge : '',
                inRange(value) ? styles.cellInRange : '',
                look?.nonTrading ? styles.cellNonTrading : '',
                look?.hasException ? styles.cellException : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => pick(value)}
              title={
                look?.nonTrading
                  ? 'Неторговый день'
                  : look?.hasException
                    ? 'Есть static-исключение'
                    : undefined
              }
            >
              {Number(value.slice(8))}
            </button>
          );
        }}
      />

      <div className={styles.footer}>
        <span className={styles.selection}>
          {start ? `${start.slice(8)}.${start.slice(5, 7)}` : '—'}
          {' – '}
          {end ? `${end.slice(8)}.${end.slice(5, 7)}` : start ? `${start.slice(8)}.${start.slice(5, 7)}` : '—'}
          {spanError && maxSpanDays != null ? (
            <span className={styles.spanHint}> (макс. {maxSpanDays} дн.)</span>
          ) : null}
        </span>
        <button type="button" className={styles.apply} onClick={apply} disabled={!start}>
          {applyLabel}
        </button>
      </div>
    </div>
  );
}
