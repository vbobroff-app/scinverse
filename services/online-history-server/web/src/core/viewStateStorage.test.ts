import { afterEach, describe, expect, it } from 'vitest';
import { loadViewState, persistViewState } from './viewStateStorage';

const STORAGE_KEY = 'ohs:viewState';

describe('viewStateStorage', () => {
  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it('возвращает нейтральное представление, если ничего не сохранено', () => {
    const v = loadViewState();
    expect(v.activeConnectionId).toBeNull();
    expect(v.activeFilters).toEqual([]);
    expect(v.expandedFutures).toEqual([]);
    expect(v.expandedSeries).toEqual([]);
  });

  it('сохраняет и восстанавливает провайдера, фильтры и раскрытые узлы', () => {
    persistViewState({
      activeConnectionId: 3,
      activeFilters: ['instruments', 'selection'],
      category: 'futures',
      onlyRecording: true,
      nonEmpty: false,
      selected: true,
      selectionScope: 'base',
      exchanges: ['MOEX'],
      expandedFutures: [100, 200],
      expandedSeries: [{ futuresId: 100, expiration: '2026-07-16' }],
    });

    const v = loadViewState();
    expect(v.activeConnectionId).toBe(3);
    expect(v.activeFilters).toEqual(['instruments', 'selection']);
    expect(v.category).toBe('futures');
    expect(v.onlyRecording).toBe(true);
    expect(v.selected).toBe(true);
    expect(v.selectionScope).toBe('base');
    expect(v.exchanges).toEqual(['MOEX']);
    expect(v.expandedFutures).toEqual([100, 200]);
    expect(v.expandedSeries).toEqual([{ futuresId: 100, expiration: '2026-07-16' }]);
  });

  it('отбрасывает неизвестные ключи фильтров и битые записи серий', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeFilters: ['instruments', 'bogus'],
        expandedSeries: [{ futuresId: 1, expiration: 'x' }, { futuresId: 'nope' }, 42],
      }),
    );
    const v = loadViewState();
    expect(v.activeFilters).toEqual(['instruments']);
    expect(v.expandedSeries).toEqual([{ futuresId: 1, expiration: 'x' }]);
  });

  it('игнорирует битый JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not-json');
    expect(loadViewState().activeConnectionId).toBeNull();
  });

  it('сохраняет и восстанавливает таймфрейм, тайм-лайн-фильтр, ТЗ и тумблеры Ганта/фильтров', () => {
    persistViewState({
      activeConnectionId: null,
      activeFilters: [],
      expandedFutures: [],
      expandedSeries: [],
      timeframe: { kind: 'sessions', unit: 'W', count: 2, includeWeekends: false },
      timeline: { weekdays: [1, 2, 3, 4, 5], fullDay: false, session: { mode: 'session', exchange: 'MOEX' } },
      displayTz: { preset: 'utc', offsetMin: 0 },
      crosshair: false,
      highlightDays: true,
      showFilters: false,
    });

    const v = loadViewState();
    expect(v.timeframe).toEqual({ kind: 'sessions', unit: 'W', count: 2, includeWeekends: false });
    expect(v.timeline).toEqual({
      weekdays: [1, 2, 3, 4, 5],
      fullDay: false,
      session: { mode: 'session', exchange: 'MOEX' },
    });
    expect(v.displayTz).toEqual({ preset: 'utc', offsetMin: 0 });
    expect(v.crosshair).toBe(false);
    expect(v.highlightDays).toBe(true);
    expect(v.showFilters).toBe(false);
  });

  it('отбрасывает невалидные таймфрейм/тайм-лайн/ТЗ', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        timeframe: { kind: 'weird' },
        timeline: { weekdays: [1, 9, -2, 6], fullDay: 'nope', session: { mode: 'ghost' } },
        displayTz: { preset: 'moon', offsetMin: 0 },
        crosshair: 'yes',
      }),
    );
    const v = loadViewState();
    expect(v.timeframe).toBeUndefined();
    expect(v.timeline).toBeUndefined();
    expect(v.displayTz).toBeUndefined();
    expect(v.crosshair).toBeUndefined();
  });
});
