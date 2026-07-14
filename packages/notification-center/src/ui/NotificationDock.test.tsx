import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('collapses to header-only height control', () => {
    const bus = createNotificationBus();
    render(<NotificationDock bus={bus} defaultExpanded />);
    const toggle = screen.getByRole('button', { name: /Центр уведомлений/i });
    fireEvent.click(toggle);
    expect(screen.queryByPlaceholderText('Поиск…')).toBeNull();
  });
});
