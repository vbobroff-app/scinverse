import { describe, expect, it } from 'vitest';
import {
  createStaticExc,
  emptyLayerDict,
  findDateLayer,
  layerIdDate,
  staticExcConnectedComponent,
  unionStaticComponentRange,
  type ScheduleLayer,
} from './scheduleLayerDict';

function dateLayer(from: string, to: string, partial?: Partial<ScheduleLayer>): ScheduleLayer {
  return {
    id: layerIdDate(from, to),
    scopeKind: 'date',
    dowMask: null,
    dateFrom: from,
    dateTo: to,
    label: `${from}–${to}`,
    mode: 'window',
    startMin: 600,
    endMin: 1200,
    ...partial,
  };
}

describe('staticExcConnectedComponent', () => {
  it('включает транзитивно связанные слои (1-10 ↔ 5-14 ↔ 12-20)', () => {
    const layers = [
      dateLayer('2026-07-01', '2026-07-10'),
      dateLayer('2026-07-05', '2026-07-14'),
      dateLayer('2026-07-12', '2026-07-20'),
    ];
    const component = staticExcConnectedComponent(layers, '2026-07-01', '2026-07-10');
    expect(component.map((l) => l.id)).toEqual([
      'date:2026-07-01:2026-07-10',
      'date:2026-07-05:2026-07-14',
      'date:2026-07-12:2026-07-20',
    ]);
    expect(unionStaticComponentRange(layers, '2026-07-01', '2026-07-10')).toEqual({
      from: '2026-07-01',
      to: '2026-07-20',
    });
  });

  it('не тянет несвязанный слой', () => {
    const layers = [
      dateLayer('2026-07-01', '2026-07-03'),
      dateLayer('2026-07-10', '2026-07-12'),
    ];
    const component = staticExcConnectedComponent(layers, '2026-07-01', '2026-07-03');
    expect(component).toHaveLength(1);
    expect(component[0].id).toBe('date:2026-07-01:2026-07-03');
  });
});

describe('createStaticExc', () => {
  it('кладёт новый слой сверху и удаляет полностью вложенные', () => {
    let dict = emptyLayerDict();
    dict = createStaticExc(dict, dateLayer('2026-07-01', '2026-07-04'));
    dict = createStaticExc(dict, dateLayer('2026-07-03', '2026-07-03'));
    expect(dict.staticExc.map((l) => l.id)).toEqual([
      'date:2026-07-01:2026-07-04',
      'date:2026-07-03:2026-07-03',
    ]);

    dict = createStaticExc(dict, dateLayer('2026-07-01', '2026-07-04', { startMin: 700 }));
    expect(dict.staticExc).toHaveLength(1);
    expect(dict.staticExc[0].startMin).toBe(700);
    expect(findDateLayer(dict, '2026-07-03', '2026-07-03')).toBeUndefined();
  });
});
