import { Fragment, useMemo, type ReactNode } from 'react';
import { WEEKDAYS_MON_FIRST, monthCells } from './monthGridModel';
import styles from './MonthGrid.module.css';

/** Переопределяемые классы (каждый потребитель держит свой вид ячеек/сетки). */
export interface MonthGridClasses {
  weekdays?: string;
  weekday?: string;
  grid?: string;
  empty?: string;
}

interface MonthGridProps {
  /** Год и месяц (0..11) сетки. */
  year: number;
  month: number;
  /** Рендер дня по ISO-дате (потребитель задаёт содержимое и стиль ячейки, включая key). */
  renderDay: (iso: string) => ReactNode;
  showWeekdays?: boolean;
  classes?: MonthGridClasses;
}

/**
 * Общий примитив «сетка месяца»: шапка дней недели (Пн-первым) + 7-колоночная сетка с ведущими
 * пустыми ячейками до 1-го числа. Только раскладка и календарная логика; вид дня и сетки задаёт
 * потребитель через {@link MonthGridProps.renderDay} и {@link MonthGridClasses}. Используется и
 * пикером диапазона дат, и витриной торгового календаря.
 */
export function MonthGrid({ year, month, renderDay, showWeekdays = true, classes }: MonthGridProps) {
  const cells = useMemo(() => monthCells(year, month), [year, month]);

  return (
    <>
      {showWeekdays && (
        <div className={classes?.weekdays ?? styles.weekdays}>
          {WEEKDAYS_MON_FIRST.map((w) => (
            <span key={w} className={classes?.weekday ?? styles.weekday}>{w}</span>
          ))}
        </div>
      )}
      <div className={classes?.grid ?? styles.grid}>
        {cells.map((iso, i) =>
          iso === null ? (
            <span key={`pad-${i}`} className={classes?.empty ?? styles.empty} aria-hidden="true" />
          ) : (
            <Fragment key={iso}>{renderDay(iso)}</Fragment>
          ),
        )}
      </div>
    </>
  );
}
