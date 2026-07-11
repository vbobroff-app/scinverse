import type { SessionDto } from './types';

/** Проецирует момент времени (ms) в позицию оси 0..100%. */
export type Projector = (ms: number) => number;

const clamp = (v: number): number => Math.min(100, Math.max(0, v));

/**
 * Строит проектор координат оси.
 *
 * Без сессий (M/Q/Y/All/диапазон) — линейная шкала реального времени.
 *
 * С сессиями (D/W) — **посессионная** шкала: ширина доли пропорциональна длительности торговой
 * сессии (сумма долей = 100%), а неторговые разрывы (ночь между сессиями) схлопываются в шов.
 * Будни (08:50–23:50 ≈ 15ч) занимают больше, чем сессия выходного дня (09:50–19:00 ≈ 9ч), поэтому
 * колбаски выходных выходят короче. Для равных по длине сессий это даёт ровные доли (D2 пополам).
 */
export function makeProjector(fromMs: number, toMs: number, sessions?: SessionDto[]): Projector {
  if (!sessions || sessions.length === 0) {
    const span = Math.max(1, toMs - fromMs);
    return (ms) => clamp(((ms - fromMs) / span) * 100);
  }

  const n = sessions.length;
  const bounds = sessions.map((s) => {
    const start = Date.parse(s.start);
    const end = Date.parse(s.end);
    return { start, end, dur: Math.max(1, end - start) };
  });
  const total = bounds.reduce((sum, b) => sum + b.dur, 0);

  // Накопленное смещение (в единицах длительности) до начала каждой сессии.
  const offset: number[] = [];
  let acc = 0;
  for (const b of bounds) {
    offset.push(acc);
    acc += b.dur;
  }

  return (ms) => {
    if (ms <= bounds[0].start) return 0;
    if (ms >= bounds[n - 1].end) return 100;
    for (let i = 0; i < n; i++) {
      const b = bounds[i];
      if (ms < b.start) return clamp((offset[i] / total) * 100); // разрыв перед сессией i → шов
      if (ms <= b.end) {
        return clamp(((offset[i] + (ms - b.start)) / total) * 100);
      }
    }
    return 100;
  };
}

/** Переводит позицию оси (0..100%) обратно в момент времени (ms). */
export type InverseProjector = (pct: number) => number;

/**
 * Инверсия {@link makeProjector}: по позиции курсора на оси возвращает момент времени.
 * Симметрична посессионной шкале — точка внутри шва (схлопнутого разрыва) отдаётся как граница
 * соседней сессии. Нужна для тултипов «дата-время под курсором».
 */
export function makeInverseProjector(fromMs: number, toMs: number, sessions?: SessionDto[]): InverseProjector {
  if (!sessions || sessions.length === 0) {
    const span = Math.max(1, toMs - fromMs);
    return (pct) => fromMs + (Math.min(100, Math.max(0, pct)) / 100) * span;
  }

  const n = sessions.length;
  const bounds = sessions.map((s) => {
    const start = Date.parse(s.start);
    const end = Date.parse(s.end);
    return { start, end, dur: Math.max(1, end - start) };
  });
  const total = bounds.reduce((sum, b) => sum + b.dur, 0);

  const offset: number[] = [];
  let acc = 0;
  for (const b of bounds) {
    offset.push(acc);
    acc += b.dur;
  }

  return (pct) => {
    const p = Math.min(100, Math.max(0, pct));
    const units = (p / 100) * total; // позиция в единицах длительности сессий
    for (let i = 0; i < n; i++) {
      if (units <= offset[i] + bounds[i].dur) {
        return bounds[i].start + Math.max(0, units - offset[i]);
      }
    }
    return bounds[n - 1].end;
  };
}
