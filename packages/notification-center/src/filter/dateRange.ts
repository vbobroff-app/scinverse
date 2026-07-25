/** Пресет диапазона дат для фильтра ленты уведомлений. */
export type DockRangePreset =
  | 'today'
  | 'yesterday'
  | 'days3'
  | 'week'
  | 'month'
  | 'all'
  | 'custom';

export interface DockRangeFilter {
  preset: DockRangePreset;
  /** YYYY-MM-DD — календарная дата в TZ фильтра (`tzOffsetMin` / локаль браузера). */
  from?: string;
  /** YYYY-MM-DD — календарная дата в TZ фильтра. */
  to?: string;
  /**
   * Сужает окно по времени: от `timeFrom` первого дня до `timeTo` последнего
   * (для открытых пресетов последний день = сегодня).
   * «За сегодня» + 15:00–24:00 → [сегодня 15:00, сегодня 24:00).
   */
  timeEnabled?: boolean;
  /** HH:mm, default 00:00 */
  timeFrom?: string;
  /** HH:mm, допускает 24:00 = конец суток, default 24:00 */
  timeTo?: string;
}

export const DEFAULT_TIME_FROM = '00:00';
export const DEFAULT_TIME_TO = '24:00';

export const EMPTY_DOCK_RANGE: DockRangeFilter = { preset: 'all' };

export const DOCK_RANGE_PRESETS: readonly { id: DockRangePreset; label: string }[] = [
  { id: 'all', label: 'за всё время' },
  { id: 'today', label: 'за сегодня' },
  { id: 'yesterday', label: 'со вчера' },
  { id: 'days3', label: 'за три дня' },
  { id: 'week', label: 'за неделю' },
  { id: 'month', label: 'за месяц' },
  { id: 'custom', label: 'ввести даты' },
] as const;

const VALID_PRESETS: readonly DockRangePreset[] = DOCK_RANGE_PRESETS.map((p) => p.id);

export function isDockRangePreset(value: unknown): value is DockRangePreset {
  return typeof value === 'string' && (VALID_PRESETS as readonly string[]).includes(value);
}

/** Начало локального календарного дня (ms). */
export function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Конец локального календарного дня (ms, включительно). */
export function endOfLocalDay(d: Date): number {
  return startOfLocalDay(d) + 86_400_000 - 1;
}

/** Парсит YYYY-MM-DD как локальную дату (полдень-safe через компоненты). */
export function parseLocalYmd(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) {
    return null;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(y, mo - 1, day);
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== day) {
    return null;
  }
  return d;
}

export function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Парсит HH:mm → ms от полуночи.
 * `allow24`: допускает `24:00` → 86_400_000 (exclusive end суток).
 */
export function parseLocalHm(hm: string, allow24 = false): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) {
    return null;
  }
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || min > 59) {
    return null;
  }
  if (allow24 && h === 24 && min === 0) {
    return 86_400_000;
  }
  if (h > 23) {
    return null;
  }
  return h * 3_600_000 + min * 60_000;
}

/** Нормализует ввод к HH:mm (или 24:00); при ошибке — fallback. */
export function normalizeLocalHm(raw: string, fallback: string, allow24 = false): string {
  const parsed = parseLocalHm(raw, allow24);
  if (parsed == null) {
    return fallback;
  }
  if (allow24 && parsed === 86_400_000) {
    return '24:00';
  }
  const h = Math.floor(parsed / 3_600_000);
  const min = Math.floor((parsed % 3_600_000) / 60_000);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

interface WallParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  ms: number;
}

/** Календарные части epoch в браузерной локали или в фиксированном UTC-сдвиге. */
export function wallPartsAt(epochMs: number, tzOffsetMin?: number): WallParts {
  if (tzOffsetMin == null) {
    const d = new Date(epochMs);
    return {
      y: d.getFullYear(),
      mo: d.getMonth(),
      d: d.getDate(),
      h: d.getHours(),
      mi: d.getMinutes(),
      s: d.getSeconds(),
      ms: d.getMilliseconds(),
    };
  }
  const shifted = new Date(epochMs + tzOffsetMin * 60_000);
  return {
    y: shifted.getUTCFullYear(),
    mo: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    mi: shifted.getUTCMinutes(),
    s: shifted.getUTCSeconds(),
    ms: shifted.getUTCMilliseconds(),
  };
}

/** Полуночь календарного дня (y, mo, d) → epoch ms. */
export function startOfWallDay(y: number, mo: number, d: number, tzOffsetMin?: number): number {
  if (tzOffsetMin == null) {
    return new Date(y, mo, d).getTime();
  }
  return Date.UTC(y, mo, d) - tzOffsetMin * 60_000;
}

/** Время суток события (ms от полуночи) в выбранной TZ. */
export function localTimeOfDayMs(epochMs: number, tzOffsetMin?: number): number {
  const p = wallPartsAt(epochMs, tzOffsetMin);
  return p.h * 3_600_000 + p.mi * 60_000 + p.s * 1_000 + p.ms;
}

function startOfYmd(ymd: string, tzOffsetMin?: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) {
    return null;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  if (mo < 1 || mo > 12 || day < 1 || day > 31) {
    return null;
  }
  const start = startOfWallDay(y, mo - 1, day, tzOffsetMin);
  const check = wallPartsAt(start, tzOffsetMin);
  if (check.y !== y || check.mo !== mo - 1 || check.d !== day) {
    return null;
  }
  return start;
}

function addWallDays(dayStartMs: number, days: number, tzOffsetMin?: number): number {
  const p = wallPartsAt(dayStartMs, tzOffsetMin);
  if (tzOffsetMin == null) {
    const d = new Date(p.y, p.mo, p.d + days);
    return startOfLocalDay(d);
  }
  // UTC-дата + days через Date.UTC
  return Date.UTC(p.y, p.mo, p.d + days) - tzOffsetMin * 60_000;
}

export interface RangeBounds {
  /** Inclusive lower bound (epoch ms), null = без нижней границы. */
  fromMs: number | null;
  /** Inclusive upper bound (epoch ms), null = без верхней границы. */
  toMs: number | null;
  /**
   * Время суток (только для preset=all + timeEnabled): inclusive lower.
   */
  todFromMs?: number | null;
  /**
   * Время суток (только для preset=all + timeEnabled): exclusive upper.
   * `24:00` → 86_400_000.
   */
  todToMs?: number | null;
}

function resolveTimeOfDay(range: DockRangeFilter): { todFromMs: number; todToMs: number } | null {
  if (!range.timeEnabled) {
    return null;
  }
  const fromRaw = range.timeFrom?.trim() || DEFAULT_TIME_FROM;
  const toRaw = range.timeTo?.trim() || DEFAULT_TIME_TO;
  return {
    todFromMs: parseLocalHm(fromRaw, false) ?? 0,
    todToMs: parseLocalHm(toRaw, true) ?? 86_400_000,
  };
}

/**
 * Резолв пресета в абсолютные границы.
 * @param tzOffsetMin смещение от UTC в минутах (как displayTz / createOffsetFormatTs);
 *   если не задано — календарь браузера.
 *
 * С `timeEnabled`: непрерывное окно от timeFrom первого дня до timeTo последнего
 * (для открытых пресетов последний = сегодня). Для `all` — фильтр только по времени суток.
 */
export function resolveRangeBounds(
  range: DockRangeFilter,
  now = new Date(),
  tzOffsetMin?: number,
): RangeBounds {
  const nowMs = now.getTime();
  const nowParts = wallPartsAt(nowMs, tzOffsetMin);
  const todayStart = startOfWallDay(nowParts.y, nowParts.mo, nowParts.d, tzOffsetMin);
  const time = resolveTimeOfDay(range);

  let fromDay: number | null = null;
  let toDay: number | null = null; // start of last inclusive day; null = open (→ today when time on)

  switch (range.preset) {
    case 'all':
      break;
    case 'today':
      fromDay = todayStart;
      toDay = null;
      break;
    case 'yesterday':
      fromDay = addWallDays(todayStart, -1, tzOffsetMin);
      toDay = null; // «со вчера» → до сейчас; с time — до сегодня timeTo
      break;
    case 'days3':
      fromDay = addWallDays(todayStart, -2, tzOffsetMin);
      toDay = null;
      break;
    case 'week':
      fromDay = addWallDays(todayStart, -6, tzOffsetMin);
      toDay = null;
      break;
    case 'month':
      fromDay = addWallDays(todayStart, -30, tzOffsetMin);
      toDay = null;
      break;
    case 'custom': {
      fromDay = range.from ? startOfYmd(range.from, tzOffsetMin) : null;
      toDay = range.to ? startOfYmd(range.to, tzOffsetMin) : null;
      break;
    }
    default:
      break;
  }

  if (!time) {
    return {
      fromMs: fromDay,
      toMs: toDay != null ? toDay + 86_400_000 - 1 : null,
    };
  }

  // all + время → только время суток (в любой день)
  if (fromDay == null && toDay == null && range.preset === 'all') {
    return { fromMs: null, toMs: null, todFromMs: time.todFromMs, todToMs: time.todToMs };
  }

  const endDay = toDay ?? todayStart;
  const fromMs = fromDay != null ? fromDay + time.todFromMs : null;
  // inclusive upper: [..., endDay + todTo)
  const toMs = endDay + time.todToMs - 1;

  return { fromMs, toMs };
}

/** Копирует time-* поля (для смены пресета без потери времени). */
export function pickRangeTime(range: DockRangeFilter): Pick<
  DockRangeFilter,
  'timeEnabled' | 'timeFrom' | 'timeTo'
> {
  const out: Pick<DockRangeFilter, 'timeEnabled' | 'timeFrom' | 'timeTo'> = {};
  if (range.timeEnabled) {
    out.timeEnabled = true;
  }
  if (range.timeFrom) {
    out.timeFrom = range.timeFrom;
  }
  if (range.timeTo) {
    out.timeTo = range.timeTo;
  }
  return out;
}

export function rangeSummary(range: DockRangeFilter | null | undefined): string | undefined {
  if (!range) {
    return undefined;
  }
  let base: string | undefined;
  if (range.preset === 'custom') {
    const a = range.from?.trim() ?? '';
    const b = range.to?.trim() ?? '';
    if (!a && !b) {
      base = 'даты…';
    } else if (a && b) {
      base = `${a} — ${b}`;
    } else {
      base = a || b;
    }
  } else {
    base = DOCK_RANGE_PRESETS.find((p) => p.id === range.preset)?.label;
  }
  if (!base) {
    return undefined;
  }
  if (!range.timeEnabled) {
    return base;
  }
  const tf = range.timeFrom?.trim() || DEFAULT_TIME_FROM;
  const tt = range.timeTo?.trim() || DEFAULT_TIME_TO;
  return `${base}, ${tf}–${tt}`;
}
