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
