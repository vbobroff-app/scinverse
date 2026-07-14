// Клиентское зеркало Scinverse.Ohs.Domain.MoexSchedule: эвристика часов MOEX.
// D/W: календарный скелет оси (recentSessions) + часы из GET /api/sessions (ISS) через
// mergeSessionHours. M/Q/Y/range и фолбэк при ошибке API — только локально.
// МСК = UTC+3 без перехода на летнее время.

import type { SessionDto } from './types';

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

/** Календарная дата момента `ms` в произвольном ТЗ (смещение в минутах от UTC). */
export function tzDateOf(ms: number, offsetMin: number): MskDate {
  const shifted = new Date(ms + offsetMin * 60_000);
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

/**
 * Границы торговой сессии MOEX для даты МСК (эвристический фолбэк).
 * Будни: 08:50–23:50. Выходные (ДСВД): 09:50–19:00.
 * Авторитетные часы — с бэка (`GET /api/sessions` ← ISS). Новый регламент СР с 14.07.2026
 * намеренно не хардкодится — ждём обновления ISS (см. docs/dev/phase7c/apply.md §3c).
 */
export function sessionBounds(date: MskDate): SessionBounds {
  const dow = weekday(date);
  const weekend = dow === 0 || dow === 6;
  const [sh, sm, eh, em] = weekend ? [9, 50, 19, 0] : [8, 50, 23, 50];
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

/** Инстант UTC для МСК-полуночи даты `yyyy-MM-dd` (для окна дня). */
export function mskMidnightMsFromIso(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d, -3, 0);
}

/** День недели (0=вс..6=сб) для ISO-даты `yyyy-MM-dd`. */
export function weekdayOfIso(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Сдвигает дату МСК на `months` месяцев назад (для таймфреймов M/Q/Y). */
export function shiftMonths(date: MskDate, months: number): MskDate {
  const base = new Date(Date.UTC(date.year, date.month - 1, date.day));
  base.setUTCMonth(base.getUTCMonth() - months);
  return { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: base.getUTCDate() };
}

/** Предыдущий календарный день (по МСК). */
export function prevDate(date: MskDate): MskDate {
  const base = new Date(Date.UTC(date.year, date.month - 1, date.day));
  base.setUTCDate(base.getUTCDate() - 1);
  return { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: base.getUTCDate() };
}

/** ISO-дата `yyyy-MM-dd` для даты МСК. */
export function isoDate({ year, month, day }: MskDate): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Накладывает часы из бэкенда (ISS) на календарный скелет оси: для совпадающих `date`
 * подменяет `start`/`end`/`weekend`, прочие дни остаются с эвристикой.
 */
export function mergeSessionHours(calendar: SessionDto[], api: SessionDto[]): SessionDto[] {
  if (api.length === 0) {
    return calendar;
  }
  const byDate = new Map(api.map((s) => [s.date, s]));
  return calendar.map((s) => {
    const fromApi = byDate.get(s.date);
    return fromApi ? { ...s, start: fromApi.start, end: fromApi.end, weekend: fromApi.weekend } : s;
  });
}

/**
 * Последние `count` календарных сессий (по МСК), заканчивая сегодняшней. Выходные включаются
 * как отдельные слоты (не схлопываются); при `includeWeekends = false` они пропускаются.
 * Часы — эвристика; для D/W поверх накладываются ISS-часы из `/api/sessions`.
 */
export function recentSessions(
  count: number,
  includeWeekends: boolean,
  now: number = Date.now(),
): SessionDto[] {
  const out: SessionDto[] = [];
  let date = mskDateOf(now);
  for (let guard = 0; out.length < count && guard < count * 3 + 14; guard++) {
    const b = sessionBounds(date);
    if (includeWeekends || !b.weekend) {
      out.push({
        date: isoDate(date),
        start: new Date(b.startMs).toISOString(),
        end: new Date(b.endMs).toISOString(),
        weekend: b.weekend,
      });
    }
    date = prevDate(date);
  }
  return out.reverse();
}

/**
 * Все сессии (по МСК) от `fromMs` до сегодняшней включительно (для календарных M/Q/Y).
 * Выходные включаются как отдельные слоты при `includeWeekends`. Ограничено ~11 годами.
 */
export function sessionsFrom(
  fromMs: number,
  includeWeekends: boolean,
  now: number = Date.now(),
): SessionDto[] {
  const out: SessionDto[] = [];
  let date = mskDateOf(now);
  for (let guard = 0; guard < 4200; guard++) {
    const b = sessionBounds(date);
    if (b.endMs < fromMs) break;
    if (includeWeekends || !b.weekend) {
      out.push({
        date: isoDate(date),
        start: new Date(b.startMs).toISOString(),
        end: new Date(b.endMs).toISOString(),
        weekend: b.weekend,
      });
    }
    date = prevDate(date);
  }
  return out.reverse();
}
