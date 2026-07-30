/**
 * Форматтеры времени для отображения.
 * Хост (OHS) передаёт свой стандарт (UTC / МСК / UTC+N); пакет не знает о DisplayTz.
 */

export type FormatTs = (iso: string) => string;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

type OffsetParts = {
  y: number;
  mo: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
};

/** Календарные части instant в TZ со смещением `offsetMin` от UTC. */
function partsInOffset(ms: number, offsetMin: number): OffsetParts {
  const shifted = new Date(ms + offsetMin * 60_000);
  return {
    y: shifted.getUTCFullYear(),
    mo: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    hh: shifted.getUTCHours(),
    mm: shifted.getUTCMinutes(),
    ss: shifted.getUTCSeconds(),
  };
}

function formatFull(p: OffsetParts): string {
  return (
    `${p.y}-${pad2(p.mo)}-${pad2(p.d)} ` +
    `${pad2(p.hh)}:${pad2(p.mm)}:${pad2(p.ss)}`
  );
}

function formatTimeOnly(p: OffsetParts): string {
  return `${pad2(p.hh)}:${pad2(p.mm)}:${pad2(p.ss)}`;
}

function sameCalendarDay(a: OffsetParts, b: OffsetParts): boolean {
  return a.y === b.y && a.mo === b.mo && a.d === b.d;
}

/** Дефолт: UTC `YYYY-MM-DD HH:mm:ss`. */
export const formatTsUtc: FormatTs = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return formatFull(partsInOffset(d.getTime(), 0));
};

/**
 * Форматтер по фиксированному смещению от UTC (минуты).
 * Пример: МСК → `createOffsetFormatTs(180)`.
 */
export function createOffsetFormatTs(offsetMin: number): FormatTs {
  return (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return iso;
    }
    return formatFull(partsInOffset(d.getTime(), offsetMin));
  };
}

/**
 * Заголовок Thread: если календарный день в display TZ = «сегодня» — только `HH:mm:ss`,
 * иначе полная дата. «Сегодня» = `nowMs` в том же offset (настройки хоста, МСК = 180).
 */
export function formatThreadTs(
  iso: string,
  offsetMin: number,
  nowMs: number = Date.now(),
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  const p = partsInOffset(d.getTime(), offsetMin);
  if (sameCalendarDay(p, partsInOffset(nowMs, offsetMin))) {
    return formatTimeOnly(p);
  }
  return formatFull(p);
}

/** Диапазон open→close или одна метка для open Thread. */
export function formatThreadTimeLabel(
  openedAt: string,
  closedAt: string | undefined,
  offsetMin: number,
  nowMs: number = Date.now(),
): string {
  if (closedAt) {
    return `${formatThreadTs(openedAt, offsetMin, nowMs)} → ${formatThreadTs(closedAt, offsetMin, nowMs)}`;
  }
  return formatThreadTs(openedAt, offsetMin, nowMs);
}
