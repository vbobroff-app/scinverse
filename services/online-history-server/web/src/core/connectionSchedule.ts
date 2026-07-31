import type { ConnectionScheduleRuleDto } from './types';

/**
 * Клиентское разрешение расписания соединения (зеркало ConnectionScheduleResolver на бэке).
 * Сессия принадлежит дню открытия; окно = open + durationMin (полуинтервал, может уходить за полночь).
 * Приоритеты: date > dow > main; внутри уровня — свежесть (effectiveFrom). mode=off ⇒ сессии нет.
 * NB: торговый день календаря здесь НЕ учитывается (клиент его не знает) — main считаем «торговым»;
 * это влияет только на визуальную подсказку фазы, не на серверную логику.
 */

const DAY_MIN = 24 * 60;

/**
 * Смещение TZ расписания от UTC в минутах. Расписание хранится в `Europe/Moscow`
 * (settings.tz), у Москвы нет перехода на летнее время с 2014 ⇒ фиксированные +180.
 */
export const SCHEDULE_TZ_OFFSET_MIN = 180;

/**
 * Date, чьи ЛОКАЛЬНЫЕ поля (`getHours`/`getDay`/`getFullYear`…) равны стенным часам в TZ с
 * офсетом `offsetMin`. Нужно, чтобы `isConnectedNow` считал в TZ расписания (МSK), а не в TZ
 * браузера — иначе на не-московской машине фаза Auto врёт (сдвиг часов и дня недели).
 */
function wallClockInTz(now: Date, offsetMin: number): Date {
  const s = new Date(now.getTime() + offsetMin * 60_000);
  return new Date(
    s.getUTCFullYear(),
    s.getUTCMonth(),
    s.getUTCDate(),
    s.getUTCHours(),
    s.getUTCMinutes(),
    s.getUTCSeconds(),
  );
}

/** Бит дня недели для маски (Пн=1…Вс=64). js day: 0=Вс..6=Сб. */
export function dowBit(jsDay: number): number {
  return jsDay === 0 ? 64 : 1 << (jsDay - 1);
}

/** "HH:mm[:ss]" → минуты от полуночи. */
export function hmsToMin(hms: string): number {
  const [h, m] = hms.split(':').map((x) => Number(x));
  return (h || 0) * 60 + (m || 0);
}

function tier(scopeKind: string): number {
  if (scopeKind === 'date') return 2;
  if (scopeKind === 'dow') return 1;
  return 0;
}

function coversDate(rule: ConnectionScheduleRuleDto, date: Date): boolean {
  switch (rule.scopeKind) {
    case 'main':
      return true;
    case 'dow':
      return rule.dowMask != null && (rule.dowMask & dowBit(date.getDay())) !== 0;
    case 'date': {
      if (!rule.dateFrom || !rule.dateTo) return false;
      const d = ymd(date);
      return d >= rule.dateFrom && d <= rule.dateTo;
    }
    default:
      return false;
  }
}

function coversDow(rule: ConnectionScheduleRuleDto, jsDay: number): boolean {
  if (rule.scopeKind === 'main') return true;
  if (rule.scopeKind === 'dow') return rule.dowMask != null && (rule.dowMask & dowBit(jsDay)) !== 0;
  return false; // date-правила в недельном обзоре не участвуют
}

function pickWinner(candidates: ConnectionScheduleRuleDto[]): ConnectionScheduleRuleDto | null {
  let best: ConnectionScheduleRuleDto | null = null;
  let bestTier = -1;
  for (const r of candidates) {
    const t = tier(r.scopeKind);
    if (t < bestTier) continue;
    if (t > bestTier || best == null || Date.parse(r.effectiveFrom) > Date.parse(best.effectiveFrom)) {
      bestTier = t;
      best = r;
    }
  }
  return best;
}

/** Победившее правило для дня недели (v1: main/dow). */
export function resolveWinnerForDow(
  rules: readonly ConnectionScheduleRuleDto[],
  jsDay: number,
): ConnectionScheduleRuleDto | null {
  return pickWinner(rules.filter((r) => coversDow(r, jsDay)));
}

/** Победившее правило для конкретной даты (учитывает date-правила). */
export function resolveWinnerForDate(
  rules: readonly ConnectionScheduleRuleDto[],
  date: Date,
): ConnectionScheduleRuleDto | null {
  return pickWinner(rules.filter((r) => coversDate(r, date)));
}

/** Локальный YYYY-MM-DD. */
function ymd(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/**
 * Подключены ли «сейчас» по эффективному расписанию (union по дням открытия вчера/сегодня).
 * Приблизительно (без торгового календаря) — для индикатора фазы Auto. Время считается в TZ
 * расписания (`offsetMin`, по умолчанию МSK): времена правил (`open`/`end`) — по МSK, поэтому
 * `now` приводится к стенным часам МSK, иначе на не-московской машине окно «уезжает».
 */
export function isConnectedNow(
  rules: readonly ConnectionScheduleRuleDto[],
  now: Date,
  offsetMin: number = SCHEDULE_TZ_OFFSET_MIN,
): boolean {
  const local = wallClockInTz(now, offsetMin);
  const nowMinToday = local.getHours() * 60 + local.getMinutes();
  const yesterday = new Date(local);
  yesterday.setDate(local.getDate() - 1);

  for (const [openDay, offsetDays] of [
    [yesterday, 1],
    [local, 0],
  ] as const) {
    const winner = resolveWinnerForDate(rules, openDay);
    if (!winner || winner.mode !== 'window' || winner.open == null || winner.durationMin == null) {
      continue;
    }
    const openMin = hmsToMin(winner.open);
    const nowFromOpen = offsetDays * DAY_MIN + nowMinToday;
    if (nowFromOpen >= openMin && nowFromOpen < openMin + winner.durationMin) {
      return true;
    }
  }
  return false;
}

/** Есть ли живые правила (Auto имеет смысл только при наличии хотя бы одного). */
export function hasLiveRules(rules: readonly ConnectionScheduleRuleDto[]): boolean {
  return rules.length > 0;
}

/** Полуоткрытый интервал в epoch ms: [fromMs, toMs). */
export interface ScheduleMsInterval {
  fromMs: number;
  toMs: number;
}

/**
 * Абсолютные desired-окна connection, пересекающие [rangeFromMs, rangeToMs).
 * Та же семантика, что Auto/`isConnectedNow` (date > dow > main; без trading calendar).
 * Без live-rules → [].
 */
export function enumerateDesiredWindows(
  rules: readonly ConnectionScheduleRuleDto[],
  rangeFromMs: number,
  rangeToMs: number,
  offsetMin: number = SCHEDULE_TZ_OFFSET_MIN,
): ScheduleMsInterval[] {
  if (!hasLiveRules(rules) || !(rangeFromMs < rangeToMs)) {
    return [];
  }

  const startWall = wallClockInTz(new Date(rangeFromMs), offsetMin);
  startWall.setHours(0, 0, 0, 0);
  startWall.setDate(startWall.getDate() - 1);

  const endWall = wallClockInTz(new Date(rangeToMs), offsetMin);
  endWall.setHours(0, 0, 0, 0);

  const raw: ScheduleMsInterval[] = [];
  for (let d = new Date(startWall); d.getTime() <= endWall.getTime(); d.setDate(d.getDate() + 1)) {
    const winner = resolveWinnerForDate(rules, d);
    if (!winner || winner.mode !== 'window' || winner.open == null || winner.durationMin == null) {
      continue;
    }
    const openMin = hmsToMin(winner.open);
    const fromMs =
      Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(openMin / 60), openMin % 60) -
      offsetMin * 60_000;
    const toMs = fromMs + winner.durationMin * 60_000;
    const clipFrom = Math.max(fromMs, rangeFromMs);
    const clipTo = Math.min(toMs, rangeToMs);
    if (clipFrom < clipTo) {
      raw.push({ fromMs: clipFrom, toMs: clipTo });
    }
  }

  return mergeHalfOpen(raw);
}

/**
 * Void-интервалы вне desired внутри [rangeFromMs, rangeToMs) — для UI mask.
 * Нет live-rules → [] (маску не рисуем).
 */
export function scheduleVoidIntervals(
  rules: readonly ConnectionScheduleRuleDto[],
  rangeFromMs: number,
  rangeToMs: number,
  offsetMin: number = SCHEDULE_TZ_OFFSET_MIN,
): ScheduleMsInterval[] {
  if (!hasLiveRules(rules) || !(rangeFromMs < rangeToMs)) {
    return [];
  }
  const desired = enumerateDesiredWindows(rules, rangeFromMs, rangeToMs, offsetMin);
  return invertHalfOpen(desired, rangeFromMs, rangeToMs);
}

/** Подпись тултипа void: «Окно простоя HH:MM – HH:MM» (стенные часы TZ расписания). */
export function formatScheduleIdleTooltip(
  fromMs: number,
  toMs: number,
  offsetMin: number = SCHEDULE_TZ_OFFSET_MIN,
): string {
  return `Окно простоя ${hhmmWall(fromMs, offsetMin)} – ${hhmmWall(toMs, offsetMin)}`;
}

function hhmmWall(ms: number, offsetMin: number): string {
  const d = wallClockInTz(new Date(ms), offsetMin);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function mergeHalfOpen(intervals: ScheduleMsInterval[]): ScheduleMsInterval[] {
  if (intervals.length === 0) {
    return [];
  }
  const sorted = [...intervals].sort((a, b) => a.fromMs - b.fromMs);
  const out: ScheduleMsInterval[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.fromMs <= last.toMs) {
      last.toMs = Math.max(last.toMs, cur.toMs);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

function invertHalfOpen(
  desired: readonly ScheduleMsInterval[],
  rangeFromMs: number,
  rangeToMs: number,
): ScheduleMsInterval[] {
  const voids: ScheduleMsInterval[] = [];
  let cursor = rangeFromMs;
  for (const d of desired) {
    if (d.fromMs > cursor) {
      voids.push({ fromMs: cursor, toMs: d.fromMs });
    }
    cursor = Math.max(cursor, d.toMs);
  }
  if (cursor < rangeToMs) {
    voids.push({ fromMs: cursor, toMs: rangeToMs });
  }
  return voids;
}
