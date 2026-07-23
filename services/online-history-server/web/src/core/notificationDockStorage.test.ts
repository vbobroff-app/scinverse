import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadNotificationDock,
  NOTIFICATION_DOCK_STORAGE_KEY,
  notificationDockStore,
} from './notificationDockStorage';

describe('notificationDockStore', () => {
  beforeEach(() => {
    localStorage.removeItem(NOTIFICATION_DOCK_STORAGE_KEY);
    localStorage.removeItem('ohs:notificationDockFilters');
    // Reset store from empty storage
    notificationDockStore.setOpen(false);
    notificationDockStore.setExpanded(false);
    notificationDockStore.clearFilters();
    notificationDockStore.setFilter({
      severities: [],
      interactions: [],
      localizations: [],
      range: { preset: 'all' },
      query: '',
    });
    notificationDockStore.setSettings({
      showFilters: true,
      trackUnread: true,
      showStatusLogo: true,
      showType: true,
      sendToTray: false,
    });
    localStorage.removeItem(NOTIFICATION_DOCK_STORAGE_KEY);
  });

  afterEach(() => {
    localStorage.removeItem(NOTIFICATION_DOCK_STORAGE_KEY);
    localStorage.removeItem('ohs:notificationDockFilters');
  });

  it('persist пишет полный снимок из RAM (open не затирает фильтры)', () => {
    notificationDockStore.applyFiltersSnapshot({
      activeFilters: ['severity', 'localization'],
      filter: {
        severities: ['info', 'error'],
        interactions: [],
        localizations: ['internal'],
        range: { preset: 'all' },
        query: 'hello',
      },
    });
    notificationDockStore.setOpen(true);

    const raw = JSON.parse(localStorage.getItem(NOTIFICATION_DOCK_STORAGE_KEY)!);
    expect(raw.open).toBe(true);
    expect(raw.activeFilters).toEqual(['severity', 'localization']);
    expect(raw.filter.severities).toEqual(['info', 'error']);
    expect(raw.filter.query).toBe('hello');

    // Как после F5: читаем LS напрямую
    const loaded = loadNotificationDock();
    expect(loaded.open).toBe(true);
    expect(loaded.activeFilters).toEqual(['severity', 'localization']);
    expect(loaded.filter.severities).toEqual(['info', 'error']);
  });

  it('toggle open сохраняет ранее заданные фильтры', () => {
    notificationDockStore.addFilter('interaction');
    notificationDockStore.setFilter({
      severities: [],
      interactions: ['system'],
      localizations: [],
      range: { preset: 'all' },
      query: '',
    });
    notificationDockStore.setOpen(true);
    notificationDockStore.setOpen(false);

    const loaded = loadNotificationDock();
    expect(loaded.open).toBe(false);
    expect(loaded.activeFilters).toEqual(['interaction']);
    expect(loaded.filter.interactions).toEqual(['system']);
  });

  it('removeFilter чистит связанные значения одним persist', () => {
    notificationDockStore.applyFiltersSnapshot({
      activeFilters: ['severity'],
      filter: {
        severities: ['warning'],
        interactions: [],
        localizations: [],
        range: { preset: 'all' },
        query: 'x',
      },
    });
    notificationDockStore.removeFilter('severity');

    const snap = notificationDockStore.snapshot();
    expect(snap.activeFilters).toEqual([]);
    expect(snap.filter.severities).toEqual([]);
    expect(snap.filter.query).toBe('x');
  });

  it('loadNotificationDock восстанавливает снимок как после F5', () => {
    notificationDockStore.setOpen(true);
    notificationDockStore.setExpanded(true);
    notificationDockStore.applyFiltersSnapshot({
      activeFilters: ['severity'],
      filter: {
        severities: ['error'],
        interactions: [],
        localizations: [],
        range: { preset: 'week' },
        query: 'reload',
      },
    });

    // Имитация нового JS-контекста: только чтение LS (без текущего RAM store).
    const reloaded = loadNotificationDock();
    expect(reloaded.open).toBe(true);
    expect(reloaded.expanded).toBe(true);
    expect(reloaded.activeFilters).toEqual(['severity']);
    expect(reloaded.filter.severities).toEqual(['error']);
    expect(reloaded.filter.query).toBe('reload');
    expect(reloaded.filter.range).toEqual({ preset: 'week' });
  });

  it('setExpanded сохраняется и не затирает open/filters', () => {
    notificationDockStore.setOpen(true);
    notificationDockStore.addFilter('severity');
    notificationDockStore.setExpanded(true);
    notificationDockStore.setExpanded(false);

    const loaded = loadNotificationDock();
    expect(loaded.open).toBe(true);
    expect(loaded.expanded).toBe(false);
    expect(loaded.activeFilters).toEqual(['severity']);
  });

  it('addFilter(range) по умолчанию ставит «за сегодня»', () => {
    notificationDockStore.addFilter('range');
    const snap = notificationDockStore.snapshot();
    expect(snap.activeFilters).toEqual(['range']);
    expect(snap.filter.range).toEqual({ preset: 'today' });
  });

  it('setSettings сохраняет toggles', () => {
    notificationDockStore.setSettings({
      showFilters: false,
      trackUnread: false,
      showStatusLogo: true,
      showType: true,
      sendToTray: true,
    });
    const loaded = loadNotificationDock();
    expect(loaded.settings.showFilters).toBe(false);
    expect(loaded.settings.trackUnread).toBe(false);
    expect(loaded.settings.showStatusLogo).toBe(true);
    expect(loaded.settings.sendToTray).toBe(true);
  });

  it('persist сохраняет период (range) в filter', () => {
    notificationDockStore.applyFiltersSnapshot({
      activeFilters: ['range'],
      filter: {
        severities: [],
        interactions: [],
        localizations: [],
        range: { preset: 'week' },
        query: '',
      },
    });
    const raw = JSON.parse(localStorage.getItem(NOTIFICATION_DOCK_STORAGE_KEY)!);
    expect(raw.activeFilters).toEqual(['range']);
    expect(raw.filter.range).toEqual({ preset: 'week' });
    expect(loadNotificationDock().filter.range).toEqual({ preset: 'week' });
  });
});
