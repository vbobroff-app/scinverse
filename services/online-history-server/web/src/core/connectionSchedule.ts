import type { ConnectionScheduleRuleDto } from './types';

/**
 * Клиентское разрешение расписания соединения (зеркало ConnectionScheduleResolver на бэке).
 * Сессия принадлежит дню открытия; окно = open + durationMin (полуинтервал, может уходить за полночь).
 * Приоритеты: date > dow > main; внутри уровня — свежесть (effectiveFrom). mode=off ⇒ сессии нет.
 * NB: торговый день календаря здесь НЕ учитывается (клиент его не знает) — main считаем «торговым»;
 * это влияет только на визуальную подсказку фазы, не на серверную логику.
 */

const DAY_MIN = 24 * 60;

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
 * Приблизительно (без торгового календаря) — для индикатора фазы Auto.
 */
export function isConnectedNow(rules: readonly ConnectionScheduleRuleDto[], now: Date): boolean {
  const nowMinToday = now.getHours() * 60 + now.getMinutes();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  for (const [openDay, offsetDays] of [
    [yesterday, 1],
    [now, 0],
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
