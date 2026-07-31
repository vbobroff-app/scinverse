import { describe, expect, it } from 'vitest';
import type { IncidentDto } from '../../core/types';
import {
  journalHasOverlappingCrash,
  mergeIncidentReds,
  projectConnectionIncidents,
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

describe('projectConnectionIncidents', () => {
  it('paints short recovered break as single red (no yellow stitch)', () => {
    const paint = projectConnectionIncidents(
      [
        breakIncident({
          corrUid: 'connection:1:link:flap',
          openedAt: '2026-07-29T14:51:10.620Z',
          closedAt: '2026-07-29T14:51:11.568Z',
          closeOutcome: 'recovered',
          owner: 'transaq',
          subtype: 'degraded',
          status: 'resolved',
        }),
      ],
      Date.parse('2026-07-29T15:00:00.000Z'),
    );
    expect(paint.bodies).toHaveLength(1);
    expect(paint.bodies[0]).toMatchObject({
      kind: 'break',
      label: 'Отсутствие связи',
    });
    expect(paint.markers.map((m) => m.label)).toEqual(['Потеря связи', 'Связь восстановлена']);
  });

  it('does not split yellow|red on escalatedAt — one solid break body', () => {
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
    );

    expect(paint.bodies).toHaveLength(1);
    expect(paint.bodies[0]).toMatchObject({
      kind: 'break',
      fromMs: Date.parse(opened),
      toMs: Date.parse(closed),
      label: 'Отсутствие связи',
    });
  });

  it('paints crash above break (higher z) with crash labels', () => {
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
          closeOutcome: 'recovered',
        }),
      ],
      Date.parse('2026-07-29T10:05:00.000Z'),
    );

    const crash = paint.bodies.find((b) => b.kind === 'crash');
    const br = paint.bodies.find((b) => b.kind === 'break');
    expect(crash!.z).toBeGreaterThan(br!.z);
    expect(crash!.label).toBe('Сервер недоступен');
    expect(paint.markers.filter((m) => m.label === 'Системный сбой')).toHaveLength(1);
    expect(paint.markers.filter((m) => m.label === 'Система восстановлена')).toHaveLength(1);
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

describe('journalHasOverlappingCrash', () => {
  const now = Date.parse('2026-07-29T12:00:00.000Z');

  it('J8: suppresses optimistic when journal crash overlaps gap', () => {
    const incidents = [
      breakIncident({
        corrUid: 'c1',
        type: 'crash',
        openedAt: '2026-07-29T10:00:00.000Z',
        closedAt: '2026-07-29T10:10:00.000Z',
      }),
    ];
    expect(
      journalHasOverlappingCrash(
        incidents,
        Date.parse('2026-07-29T10:05:00.000Z'),
        Date.parse('2026-07-29T10:08:00.000Z'),
        now,
      ),
    ).toBe(true);
  });

  it('J8: keeps optimistic when only break in journal', () => {
    const incidents = [
      breakIncident({
        corrUid: 'b1',
        openedAt: '2026-07-29T10:00:00.000Z',
        closedAt: '2026-07-29T10:10:00.000Z',
      }),
    ];
    expect(
      journalHasOverlappingCrash(
        incidents,
        Date.parse('2026-07-29T10:05:00.000Z'),
        Date.parse('2026-07-29T10:08:00.000Z'),
        now,
      ),
    ).toBe(false);
  });
});
