import { Fragment, useMemo, type ReactNode } from 'react';
import styles from './MonthGrid.module.css';

/** Русские названия месяцев (index 0..11). */
export const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

/** Дни недели, понедельник первым. */
export const WEEKDAYS_MON_FIRST = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** ISO `yyyy-MM-dd` из компонентов даты (month 0..11). */
export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Индекс дня недели 1-го числа месяца, Пн=0..Вс=6 (month 0..11). */
export function firstWeekdayMonFirst(year: number, month: number): number {
  return (new Date(year, month, 1).getDay() + 6) % 7;
}

/** Ячейки месяца: ведущие `null` (до понедельника) + ISO-строки дней 1..N (month 0..11). */
export function monthCells(year: number, month: number): (string | null)[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const lead = firstWeekdayMonFirst(year, month);
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(isoDate(year, month, day));
  }
  return cells;
}

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
