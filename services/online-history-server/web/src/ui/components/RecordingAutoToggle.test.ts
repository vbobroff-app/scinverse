import { describe, expect, it } from 'vitest';
import { autoPhase } from './RecordingAutoToggle';

describe('autoPhase', () => {
  it('off когда Auto выключен', () => {
    expect(
      autoPhase({ autoEnabled: false, inSession: true, recording: true, connectionReady: true }),
    ).toBe('off');
  });

  it('зелёный (waiting) вне сессии при живой связи: «всё ок, включу по расписанию»', () => {
    expect(
      autoPhase({ autoEnabled: true, inSession: false, recording: false, connectionReady: true }),
    ).toBe('waiting');
  });

  it('жёлтый (connecting) вне сессии без связи (не зелёный!)', () => {
    expect(
      autoPhase({ autoEnabled: true, inSession: false, recording: false, connectionReady: false }),
    ).toBe('connecting');
  });

  it('голубой (active) когда реально пишет — независимо от фронтовой оценки сессии', () => {
    expect(
      autoPhase({ autoEnabled: true, inSession: true, recording: true, connectionReady: true }),
    ).toBe('active');
    // Ключевой кейс: запись идёт, но ось sessions$ показывает прошлый день (inSession=false).
    expect(
      autoPhase({ autoEnabled: true, inSession: false, recording: true, connectionReady: true }),
    ).toBe('active');
  });

  it('жёлтый (connecting) в сессии, связь есть, но ещё не пишет', () => {
    expect(
      autoPhase({ autoEnabled: true, inSession: true, recording: false, connectionReady: true }),
    ).toBe('connecting');
  });

  it('жёлтый (connecting) без связи, даже если помечен recording', () => {
    expect(
      autoPhase({ autoEnabled: true, inSession: true, recording: true, connectionReady: false }),
    ).toBe('connecting');
  });
});
