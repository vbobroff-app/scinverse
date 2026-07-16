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
  /** YYYY-MM-DD (local), для preset=custom */
  from?: string;
  /** YYYY-MM-DD (local), для preset=custom */
  to?: string;
}

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

export interface RangeBounds {
  /** Inclusive lower bound (epoch ms), null = без нижней границы. */
  fromMs: number | null;
  /** Inclusive upper bound (epoch ms), null = без верхней границы. */
  toMs: number | null;
}

/**
 * Резолв пресета диапазона в абсолютные границы (локальный календарь).
 * «со вчера» / «за N дней» — от начала соответствующего дня до сейчас (toMs=null).
 */
export function resolveRangeBounds(range: DockRangeFilter, now = new Date()): RangeBounds {
  const todayStart = startOfLocalDay(now);

  switch (range.preset) {
    case 'all':
      return { fromMs: null, toMs: null };
    case 'today':
      return { fromMs: todayStart, toMs: null };
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { fromMs: startOfLocalDay(y), toMs: null };
    }
    case 'days3': {
      const d = new Date(now);
      d.setDate(d.getDate() - 2);
      return { fromMs: startOfLocalDay(d), toMs: null };
    }
    case 'week': {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      return { fromMs: startOfLocalDay(d), toMs: null };
    }
    case 'month': {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      return { fromMs: startOfLocalDay(d), toMs: null };
    }
    case 'custom': {
      const from = range.from ? parseLocalYmd(range.from) : null;
      const to = range.to ? parseLocalYmd(range.to) : null;
      return {
        fromMs: from ? startOfLocalDay(from) : null,
        toMs: to ? endOfLocalDay(to) : null,
      };
    }
    default:
      return { fromMs: null, toMs: null };
  }
}

export function rangeSummary(range: DockRangeFilter | null | undefined): string | undefined {
  if (!range) {
    return undefined;
  }
  if (range.preset === 'custom') {
    const a = range.from?.trim() ?? '';
    const b = range.to?.trim() ?? '';
    if (!a && !b) {
      return 'даты…';
    }
    if (a && b) {
      return `${a} — ${b}`;
    }
    return a || b;
  }
  return DOCK_RANGE_PRESETS.find((p) => p.id === range.preset)?.label;
}
