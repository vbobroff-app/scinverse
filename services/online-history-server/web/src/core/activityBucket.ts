import type { Timeframe } from './types';

/**
 * Статическая лесенка бакетов слоя сделок (phase 7g): фиксированный временной шаг на каждый
 * горизонт, монотонно растущий с числом дней. Не зависит от ширины экрана — это делает агрегаты
 * кэшируемыми (стабильный ключ). Значения из плана 7g:
 * D1=30с · D2–D3=1мин · W=5мин · M=30мин · Q=2ч · Y=12ч · All=1день.
 */
const LADDER: readonly { maxDays: number; seconds: number }[] = [
  { maxDays: 1, seconds: 30 },
  { maxDays: 3, seconds: 60 },
  { maxDays: 10, seconds: 300 },
  { maxDays: 40, seconds: 1800 },
  { maxDays: 130, seconds: 7200 },
  { maxDays: 400, seconds: 43200 },
];

const DAY_BUCKET_SECONDS = 86400;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Число календарных дней в горизонте таймфрейма (для выбора ступени лесенки). */
function horizonDays(tf: Timeframe): number {
  switch (tf.kind) {
    case 'all':
      return Number.POSITIVE_INFINITY;
    case 'range':
      return Math.max(1, Math.ceil((Date.parse(tf.to) - Date.parse(tf.from)) / DAY_MS));
    case 'sessions': {
      const perUnit = { D: 1, W: 7, M: 30, Q: 90, Y: 365 } as const;
      return Math.max(1, tf.count * perUnit[tf.unit]);
    }
  }
}

/** Размер бакета слоя сделок (сек) для таймфрейма: ближайшая ступень лесенки по числу дней. */
export function bucketSecondsForTimeframe(tf: Timeframe): number {
  const days = horizonDays(tf);
  const step = LADDER.find((s) => days <= s.maxDays);
  return step ? step.seconds : DAY_BUCKET_SECONDS;
}
