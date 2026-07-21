import { describe, expect, it } from 'vitest';
import {
  createStaticExc,
  emptyLayerDict,
  findDateLayer,
  layerIdDate,
  normalizeRegularExc,
  promoteExc,
  regularBoardSlots,
  resolveLayerForDow,
  staticBoardSlots,
  staticExcConnectedComponent,
  unionStaticComponentRange,
  type ScheduleLayer,
  type ScheduleLayerDict,
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

describe('normalizeRegularExc / resolve with optional main', () => {
  it('ставит group ниже singles независимо от порядка ввода', () => {
    const weekday: ScheduleLayer = {
      id: 'dow:31',
      scopeKind: 'dow',
      dowMask: 31,
      dateFrom: null,
      dateTo: null,
      label: 'Будни',
      mode: 'window',
      startMin: 600,
      endMin: 1200,
    };
    const mon: ScheduleLayer = {
      id: 'dow:1',
      scopeKind: 'dow',
      dowMask: 1,
      dateFrom: null,
      dateTo: null,
      label: 'Пн',
      mode: 'off',
      startMin: 0,
      endMin: 0,
    };
    expect(normalizeRegularExc([mon, weekday]).map((e) => e.id)).toEqual(['dow:31', 'dow:1']);
  });

  it('promoteExc XOR для групп', () => {
    let dict = emptyLayerDict();
    dict = promoteExc(dict, {
      id: 'dow:31',
      scopeKind: 'dow',
      dowMask: 31,
      dateFrom: null,
      dateTo: null,
      label: 'Будни',
      mode: 'window',
      startMin: 600,
      endMin: 1200,
    });
    dict = promoteExc(dict, {
      id: 'dow:96',
      scopeKind: 'dow',
      dowMask: 96,
      dateFrom: null,
      dateTo: null,
      label: 'Сб,Вс',
      mode: 'window',
      startMin: 700,
      endMin: 1100,
    });
    expect(dict.exc).toHaveLength(1);
    expect(dict.exc[0].dowMask).toBe(96);
  });

  it('resolveLayerForDow: null без main и без покрытия', () => {
    const dict = emptyLayerDict();
    expect(resolveLayerForDow(dict, 1)).toBeNull();
  });

  it('resolveLayerForDow: single бьёт group; main необязателен', () => {
    let dict = emptyLayerDict();
    dict = promoteExc(dict, {
      id: 'dow:31',
      scopeKind: 'dow',
      dowMask: 31,
      dateFrom: null,
      dateTo: null,
      label: 'Будни',
      mode: 'window',
      startMin: 600,
      endMin: 1200,
    });
    dict = promoteExc(dict, {
      id: 'dow:1',
      scopeKind: 'dow',
      dowMask: 1,
      dateFrom: null,
      dateTo: null,
      label: 'Пн',
      mode: 'off',
      startMin: 0,
      endMin: 0,
    });
    expect(resolveLayerForDow(dict, 1)?.id).toBe('dow:1');
    expect(resolveLayerForDow(dict, 2)?.id).toBe('dow:31');
    expect(resolveLayerForDow(dict, 0)).toBeNull();
  });
});

describe('regularBoardSlots (tetris)', () => {
  const main: ScheduleLayer = {
    id: 'main',
    scopeKind: 'main',
    dowMask: null,
    dateFrom: null,
    dateTo: null,
    label: 'Все',
    mode: 'window',
    startMin: 360,
    endMin: 1500,
  };
  const weekdays: ScheduleLayer = {
    id: 'dow:31',
    scopeKind: 'dow',
    dowMask: 31,
    dateFrom: null,
    dateTo: null,
    label: 'Будни',
    mode: 'window',
    startMin: 600,
    endMin: 1200,
  };
  const tue: ScheduleLayer = {
    id: 'dow:2',
    scopeKind: 'dow',
    dowMask: 2,
    dateFrom: null,
    dateTo: null,
    label: 'Вт',
    mode: 'off',
    startMin: 0,
    endMin: 0,
  };

  it('этаж 0 всегда main, даже если main=null', () => {
    const slots = regularBoardSlots(emptyLayerDict(), 2);
    expect(slots).toEqual([{ kind: 'main', layer: null }]);
  });

  it('Вт без группы падает на main (этаж 1)', () => {
    const dict: ScheduleLayerDict = { main, exc: [tue], staticExc: [] };
    expect(regularBoardSlots(dict, 2).map((s) => s.kind)).toEqual(['main', 'single']);
  });

  it('Вт + будни: single на 3-м этаже над group', () => {
    const dict: ScheduleLayerDict = { main, exc: [weekdays, tue], staticExc: [] };
    expect(regularBoardSlots(dict, 2).map((s) => s.kind)).toEqual(['main', 'group', 'single']);
  });

  it('выходной при буднях: только main (группа не покрывает)', () => {
    const dict: ScheduleLayerDict = { main, exc: [weekdays], staticExc: [] };
    expect(regularBoardSlots(dict, 0).map((s) => s.kind)).toEqual(['main']);
  });
});

describe('staticBoardSlots (tetris, без main)', () => {
  it('на день без static — пусто', () => {
    expect(staticBoardSlots(emptyLayerDict(), '2026-07-10')).toEqual([]);
  });

  it('одиночный слой падает на дно колонки', () => {
    let dict = emptyLayerDict();
    dict = createStaticExc(dict, dateLayer('2026-07-01', '2026-07-10'));
    expect(staticBoardSlots(dict, '2026-07-05').map((l) => l.id)).toEqual([
      'date:2026-07-01:2026-07-10',
    ]);
    expect(staticBoardSlots(dict, '2026-07-20')).toEqual([]);
  });

  it('пересечение: нижний board level снизу, верхний сверху; без дыр на день только с верхним', () => {
    let dict = emptyLayerDict();
    dict = createStaticExc(dict, dateLayer('2026-07-01', '2026-07-10'));
    dict = createStaticExc(dict, dateLayer('2026-07-05', '2026-07-14'));
    expect(staticBoardSlots(dict, '2026-07-03').map((l) => l.id)).toEqual([
      'date:2026-07-01:2026-07-10',
    ]);
    expect(staticBoardSlots(dict, '2026-07-07').map((l) => l.id)).toEqual([
      'date:2026-07-01:2026-07-10',
      'date:2026-07-05:2026-07-14',
    ]);
    expect(staticBoardSlots(dict, '2026-07-12').map((l) => l.id)).toEqual([
      'date:2026-07-05:2026-07-14',
    ]);
  });
});
