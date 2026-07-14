/**
 * Форматтеры времени для отображения.
 * Хост (OHS) передаёт свой стандарт (UTC / МСК / UTC+N); пакет не знает о DisplayTz.
 */

export type FormatTs = (iso: string) => string;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Дефолт: UTC `YYYY-MM-DD HH:mm:ss`. */
export const formatTsUtc: FormatTs = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
  );
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
    const shifted = new Date(d.getTime() + offsetMin * 60_000);
    return (
      `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())} ` +
      `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}:${pad2(shifted.getUTCSeconds())}`
    );
  };
}
