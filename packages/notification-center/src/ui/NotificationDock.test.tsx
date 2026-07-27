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
        threadStatuses: [],
        choices: [],
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

  it('фон-маска по lifecycle × severity (без pill)', () => {
    const bus = createNotificationBus();
    notify.error(bus, { id: 'e', module: 'm', code: 'c', message: 'Открытая ошибка' });
    notify.warn(bus, { id: 'w', module: 'm', code: 'c', message: 'Открытый ворнинг' });
    notify.info(bus, { id: 'i', module: 'm', code: 'c', message: 'Инфо' });
    notify.ok(bus, {
      id: 'r',
      module: 'm',
      code: 'connection.recovered',
      message: 'Решено',
      status: 'resolved',
    });

    render(<NotificationDock bus={bus} defaultExpanded />);
    const bgOf = (text: string) =>
      screen.getByText(text).closest('div[class*="row"]')?.className ?? '';

    expect(bgOf('Открытая ошибка')).toContain('bgAlert');
    expect(bgOf('Открытый ворнинг')).toContain('bgWarning');
    expect(bgOf('Решено')).toContain('bgResolved');
    // info без маски и без bg-класса.
    expect(bgOf('Инфо')).not.toMatch(/bgAlert|bgWarning|bgResolved/);
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
            threadStatuses: [],
            choices: [],
            range: { preset: 'all' },
            query: '',
          },
        }}
      />,
    );

    // Thread header показывает last message; Entry стек свёрнут.
    expect(screen.getByText('Восстановлено')).toBeTruthy();
    expect(screen.queryByText('Потеря связи')).toBeNull();
  });

  it('renders Thread container without severity icon on header; expands Entry stack', () => {
    const bus = createNotificationBus();
    bus.publish({
      id: 'open',
      ts: '2026-07-14T12:00:00.000Z',
      severity: 'error',
      sourceType: 'system',
      module: 'm',
      code: 'connection.lost',
      message: 'Потеря связи',
      status: 'active',
      correlationId: 'connection:x:link',
      data: { threadKindHint: 'incident' },
    });
    bus.publish({
      id: 'close',
      ts: '2026-07-14T12:01:00.000Z',
      severity: 'ok',
      sourceType: 'system',
      module: 'm',
      code: 'connection.recovered',
      message: 'Восстановлено',
      status: 'resolved',
      correlationId: 'connection:x:link',
      data: { closeOutcome: 'recovered' },
    });

    render(<NotificationDock bus={bus} defaultExpanded />);

    expect(screen.getByText('Incident')).toBeTruthy();
    expect(screen.getByText('Восстановлено')).toBeTruthy();
    // стек свёрнут — Entry-строка open не видна как отдельный текст статуса FATAL в header
    expect(screen.queryByText('FATAL:')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Раскрыть нить/i }));
    expect(screen.getByText('Потеря связи')).toBeTruthy();
    // break-инцидент — BreakIncidentIcon; Entry без kind-бейджа.
    expect(screen.getByLabelText('Incident (break)')).toBeTruthy();
  });
});
