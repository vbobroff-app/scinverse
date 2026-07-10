// Клиентское зеркало Scinverse.Ohs.Domain.MoexSchedule: часы торговой сессии MOEX.
// Нужно для вычисления «конца сегодняшней сессии» (правый край окна) и снапа
// произвольного диапазона к границам сессий. Единый источник правды — бэкенд
// (GET /api/sessions), но границы для «сегодня»/произвольных дат считаем локально,
// т.к. данных за них может ещё не быть. МСК = UTC+3 без перехода на летнее время.

const MSK_OFFSET_MIN = 180;

/** Календарная дата в МСК (компоненты). */
export interface MskDate {
  year: number;
  month: number; // 1..12
  day: number;
}

export interface SessionBounds {
  startMs: number;
  endMs: number;
  weekend: boolean;
}

/** Момент UTC, соответствующий указанному времени МСК. */
function mskInstant(year: number, month: number, day: number, hour: number, minute: number): number {
  return Date.UTC(year, month - 1, day, hour - 3, minute);
}

/** Дата в МСК для момента `ms` (по умолчанию — «сейчас»). */
export function mskDateOf(ms: number = Date.now()): MskDate {
  const shifted = new Date(ms + MSK_OFFSET_MIN * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** День недели (0=вс..6=сб) для даты МСК. */
function weekday({ year, month, day }: MskDate): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Границы торговой сессии MOEX для даты МСК (будни 08:50–23:50, выходные 10:00–19:00). */
export function sessionBounds(date: MskDate): SessionBounds {
  const dow = weekday(date);
  const weekend = dow === 0 || dow === 6;
  const [sh, sm, eh, em] = weekend ? [10, 0, 19, 0] : [8, 50, 23, 50];
  return {
    startMs: mskInstant(date.year, date.month, date.day, sh, sm),
    endMs: mskInstant(date.year, date.month, date.day, eh, em),
    weekend,
  };
}

/** Границы сегодняшней (по МСК) сессии. */
export function todaySession(now: number = Date.now()): SessionBounds {
  return sessionBounds(mskDateOf(now));
}

/** Дата МСК из ISO-строки `yyyy-MM-dd` (для произвольного диапазона). */
export function mskDateFromIso(iso: string): MskDate {
  const [y, m, d] = iso.split('-').map(Number);
  return { year: y, month: m, day: d };
}

/** Сдвигает дату МСК на `months` месяцев назад (для таймфреймов M/Q/Y). */
export function shiftMonths(date: MskDate, months: number): MskDate {
  const base = new Date(Date.UTC(date.year, date.month - 1, date.day));
  base.setUTCMonth(base.getUTCMonth() - months);
  return { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: base.getUTCDate() };
}
