import { describe, expect, it } from 'vitest';
import type { IncidentDto } from '../../core/types';
import {
  mergeIncidentReds,
  projectConnectionIncidents,
  resolveIncidentEscalatedMs,
} from './incidentRibbonProjection';

function breakIncident(partial: Partial<IncidentDto> & Pick<IncidentDto, 'corrUid' | 'openedAt'>): IncidentDto {
  return {
    module: 'connection',
    type: 'break',
    status: 'resolved',
    subject: 'connection:1:link',
    severity: 'error',
    title: 'lost',
    lastActivityAt: partial.openedAt,
    durationMs: 0,
    ...partial,
  };
}

describe('resolveIncidentEscalatedMs', () => {
  const from = Date.parse('2026-07-29T10:00:00.000Z');
  const to = from + 120_000;

  it('uses escalatedAt capped by T', () => {
    const esc = new Date(from + 90_000).toISOString();
    expect(
      resolveIncidentEscalatedMs(
        { type: 'break', owner: 'transaq', subtype: 'degraded', escalatedAt: esc },
        from,
        to,
        60,
      ),
    ).toBe(from + 60_000);
  });

  it('returns null for immediate supervisor break', () => {
    expect(
      resolveIncidentEscalatedMs(
        { type: 'break', owner: 'supervisor', subtype: 'down', escalatedAt: null },
        from,
        to,
        60,
      ),
    ).toBeNull();
  });
});

describe('projectConnectionIncidents', () => {
  it('splits yellow|red on escalatedAt and adds recover marker', () => {
    const opened = '2026-07-29T10:00:00.000Z';
    const esc = '2026-07-29T10:00:40.000Z';
    const closed = '2026-07-29T10:02:00.000Z';
    const paint = projectConnectionIncidents(
      [
        breakIncident({
          corrUid: 'connection:1:link:a',
          openedAt: opened,
          escalatedAt: esc,
          closedAt: closed,
          closeOutcome: 'recovered',
          owner: 'supervisor',
          subtype: 'down',
          status: 'resolved',
        }),
      ],
      Date.parse(closed),
      60,
    );

    expect(paint.bodies).toHaveLength(2);
    expect(paint.bodies[0].kind).toBe('transaq');
    expect(paint.bodies[1].kind).toBe('supervisor');
    expect(paint.markers.filter((m) => m.kind === 'start')).toHaveLength(1);
    expect(paint.markers.filter((m) => m.kind === 'recover')).toHaveLength(1);
  });

  it('paints crash above break (higher z)', () => {
    const paint = projectConnectionIncidents(
      [
        breakIncident({
          corrUid: 'connection:1:link:b',
          openedAt: '2026-07-29T10:00:00.000Z',
          closedAt: '2026-07-29T10:05:00.000Z',
          owner: 'supervisor',
        }),
        breakIncident({
          corrUid: 'ohs.backend.outage:x',
          openedAt: '2026-07-29T10:01:00.000Z',
          closedAt: '2026-07-29T10:03:00.000Z',
          type: 'crash',
          subject: 'ohs.backend.outage',
        }),
      ],
      Date.parse('2026-07-29T10:05:00.000Z'),
    );

    const crash = paint.bodies.find((b) => b.kind === 'crash');
    const br = paint.bodies.find((b) => b.kind === 'supervisor');
    expect(crash!.z).toBeGreaterThan(br!.z);
  });
});

describe('mergeIncidentReds', () => {
  it('merges overlapping break+crash into one red span', () => {
    const merged = mergeIncidentReds(
      [
        breakIncident({
          corrUid: 'a',
          openedAt: '2026-07-29T10:00:00.000Z',
          closedAt: '2026-07-29T10:05:00.000Z',
        }),
        breakIncident({
          corrUid: 'b',
          openedAt: '2026-07-29T10:02:00.000Z',
          closedAt: '2026-07-29T10:06:00.000Z',
          type: 'crash',
        }),
      ],
      Date.parse('2026-07-29T12:00:00.000Z'),
    );

    expect(merged).toEqual([
      {
        fromMs: Date.parse('2026-07-29T10:00:00.000Z'),
        toMs: Date.parse('2026-07-29T10:06:00.000Z'),
      },
    ]);
  });

  it('H1: open break (Degraded) paints red to now', () => {
    const now = Date.parse('2026-07-29T10:30:00.000Z');
    const merged = mergeIncidentReds(
      [
        breakIncident({
          corrUid: 'degraded',
          openedAt: '2026-07-29T10:00:00.000Z',
          status: 'active',
          subtype: 'degraded',
          owner: 'transaq',
        }),
      ],
      now,
    );

    expect(merged).toEqual([
      {
        fromMs: Date.parse('2026-07-29T10:00:00.000Z'),
        toMs: now,
      },
    ]);
  });
});
