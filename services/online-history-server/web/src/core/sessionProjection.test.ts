import { describe, expect, it } from 'vitest';
import { makeProjector } from './sessionProjection';
import type { SessionDto } from './types';

function session(date: string, start: string, end: string, weekend = false): SessionDto {
  return { date, start, end, weekend };
}

// Будни ЕТС 08:50–23:50 МСК (+03:00), ночь между сессиями ~9ч схлопывается в шов.
const s1 = session('2026-07-06', '2026-07-06T08:50:00+03:00', '2026-07-06T23:50:00+03:00');
const s2 = session('2026-07-07', '2026-07-07T08:50:00+03:00', '2026-07-07T23:50:00+03:00');
const s3 = session('2026-07-08', '2026-07-08T08:50:00+03:00', '2026-07-08T23:50:00+03:00');
// Суббота — доп. сессия выходного дня 09:50–19:00 (≈9ч, короче будней ≈15ч).
const sat = session('2026-07-11', '2026-07-11T09:50:00+03:00', '2026-07-11T19:00:00+03:00', true);

const at = (iso: string) => Date.parse(iso);

describe('makeProjector', () => {
  it('без сессий — линейная шкала', () => {
    const from = at('2026-07-06T00:00:00Z');
    const to = at('2026-07-06T10:00:00Z');
    const p = makeProjector(from, to, []);
    expect(p(from)).toBe(0);
    expect(p(to)).toBe(100);
    expect(p(at('2026-07-06T05:00:00Z'))).toBeCloseTo(50, 5);
  });

  it('D2 — две равные половины независимо от длины ночи', () => {
    const p = makeProjector(at(s1.start), at(s2.end), [s1, s2]);
    expect(p(at(s1.start))).toBe(0);
    expect(p(at(s1.end))).toBeCloseTo(50, 5); // конец 1-й сессии = шов
    expect(p(at(s2.start))).toBeCloseTo(50, 5); // начало 2-й тоже 50 (ночь схлопнута)
    expect(p(at(s2.end))).toBe(100);
  });

  it('середина каждой сессии D2 — 25% и 75%', () => {
    const p = makeProjector(at(s1.start), at(s2.end), [s1, s2]);
    const mid1 = (at(s1.start) + at(s1.end)) / 2;
    const mid2 = (at(s2.start) + at(s2.end)) / 2;
    expect(p(mid1)).toBeCloseTo(25, 5);
    expect(p(mid2)).toBeCloseTo(75, 5);
  });

  it('D3 — три равные трети', () => {
    const p = makeProjector(at(s1.start), at(s3.end), [s1, s2, s3]);
    expect(p(at(s1.end))).toBeCloseTo(100 / 3, 5);
    expect(p(at(s2.end))).toBeCloseTo(200 / 3, 5);
    expect(p(at(s3.end))).toBe(100);
  });

  it('момент в ночном разрыве прижимается к шву', () => {
    const p = makeProjector(at(s1.start), at(s2.end), [s1, s2]);
    const night = at('2026-07-07T03:00:00+03:00'); // между s1.end и s2.start
    expect(p(night)).toBeCloseTo(50, 5);
  });

  it('выходная сессия уже будней (доля пропорциональна длительности)', () => {
    const p = makeProjector(at(s1.start), at(sat.end), [s1, sat]);
    const boundary = p(at(s1.end)); // конец будней = начало выходной доли
    const weekdayWidth = boundary;
    const weekendWidth = 100 - boundary;
    // 15ч против 9ч10м → будни ≈62%, выходные ≈38%.
    expect(boundary).toBeCloseTo((15 / (15 + 55 / 6)) * 100, 1);
    expect(weekdayWidth).toBeGreaterThan(weekendWidth);
  });
});
