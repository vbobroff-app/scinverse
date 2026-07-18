import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createNotificationBus } from '../bus/NotificationBus';
import { notify } from '../bus/notify';
import { createOffsetFormatTs } from '../format/formatTs';
import { NotificationDock } from './NotificationDock';

describe('NotificationDock', () => {
  it('renders title, expands, shows formatted time from host formatter', () => {
    const bus = createNotificationBus();
    notify.error(bus, {
      id: 'e1',
      module: 'ohs.connection',
      code: 'connection.error',
      message: 'Нет связи',
      ts: '2026-07-14T12:00:00.000Z',
      sourceType: 'system',
    });

    render(
      <NotificationDock bus={bus} formatTs={createOffsetFormatTs(180)} defaultExpanded />,
    );

    expect(screen.getByText('Центр уведомлений')).toBeTruthy();
    expect(screen.getByText('Нет связи')).toBeTruthy();
    expect(screen.getByText('2026-07-14 15:00:00')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy(); // unread badge
  });

  it('collapses to header-only height control', async () => {
    const bus = createNotificationBus();
    render(<NotificationDock bus={bus} defaultExpanded />);
    const toggle = screen.getByRole('button', { name: /Центр уведомлений/i });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Поиск…')).toBeNull();
    });
  });

  it('controlled filters: изменение зовёт onFiltersChange', () => {
    const bus = createNotificationBus();
    const seen: unknown[] = [];
    const filters = {
      activeFilters: ['severity' as const],
      filter: {
        severities: ['info' as const],
        interactions: [],
        localizations: [],
        statuses: [],
        range: { preset: 'all' as const },
        query: '',
      },
    };

    render(
      <NotificationDock
        bus={bus}
        defaultExpanded
        filters={filters}
        onFiltersChange={(s) => seen.push(s)}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Поиск…'), { target: { value: 'abc' } });
    expect(seen.length).toBeGreaterThan(0);
    const last = seen[seen.length - 1] as {
      filter: { query: string; severities: string[] };
      activeFilters: string[];
    };
    expect(last.filter.query).toBe('abc');
    expect(last.filter.severities).toEqual(['info']);
    expect(last.activeFilters).toEqual(['severity']);
  });

  it('renders lifecycle status pill for underway/resolved', () => {
    const bus = createNotificationBus();
    notify.info(bus, {
      id: 'u1',
      module: 'ohs.connection',
      code: 'connection.reconnecting',
      message: 'Реконнект',
      status: 'underway',
      correlationId: 'c',
    });
    notify.ok(bus, {
      id: 'r1',
      module: 'ohs.connection',
      code: 'connection.recovered',
      message: 'Связь восстановлена',
      status: 'resolved',
      correlationId: 'c2',
    });

    render(<NotificationDock bus={bus} defaultExpanded />);
    expect(screen.getByText('восстановление')).toBeTruthy();
    expect(screen.getByText('решено')).toBeTruthy();
  });

  it('status filter hides non-matching rows', () => {
    const bus = createNotificationBus();
    notify.error(bus, {
      id: 'a1',
      module: 'm',
      code: 'connection.lost',
      message: 'Потеря связи',
      status: 'active',
      correlationId: 'c1',
    });
    notify.ok(bus, {
      id: 'r1',
      module: 'm',
      code: 'connection.recovered',
      message: 'Восстановлено',
      status: 'resolved',
      correlationId: 'c2',
    });

    render(
      <NotificationDock
        bus={bus}
        defaultExpanded
        filters={{
          activeFilters: ['status'],
          filter: {
            severities: [],
            interactions: [],
            localizations: [],
            statuses: ['resolved'],
            range: { preset: 'all' },
            query: '',
          },
        }}
      />,
    );

    expect(screen.getByText('Восстановлено')).toBeTruthy();
    expect(screen.queryByText('Потеря связи')).toBeNull();
  });

  it('dims resolved and superseded rows of an incident', () => {
    const bus = createNotificationBus();
    // Один инцидент: lost(active) → recovered(resolved). Оба видимы; свежее (resolved) — актуальное.
    notify.error(bus, {
      id: 'lost',
      module: 'm',
      code: 'connection.lost',
      message: 'Потеря',
      status: 'active',
      correlationId: 'link:1',
    });
    notify.ok(bus, {
      id: 'rec',
      module: 'm',
      code: 'connection.recovered',
      message: 'Восстановлено',
      status: 'resolved',
      correlationId: 'link:1',
    });

    render(<NotificationDock bus={bus} defaultExpanded />);

    const dimmedOf = (text: string) => {
      const row = screen.getByText(text).closest('div[class*="row"]');
      return row?.className.includes('dimmed') ?? false;
    };
    // resolved (актуальное) тускнеет как закрытый инцидент; active (перекрытое) — как не последнее.
    expect(dimmedOf('Восстановлено')).toBe(true);
    expect(dimmedOf('Потеря')).toBe(true);
  });
});
