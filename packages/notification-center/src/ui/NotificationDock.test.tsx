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
});
