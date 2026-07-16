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
      query: '',
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
});
