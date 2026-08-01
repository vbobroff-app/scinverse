import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DockFilters, EMPTY_DOCK_FILTER } from './DockFilters';

describe('DockFilters period time', () => {
  it('toggles «ввести время» and commits timeEnabled', () => {
    const onCommit = vi.fn();
    render(
      <DockFilters
        value={{ ...EMPTY_DOCK_FILTER, range: { preset: 'today' } }}
        onChange={vi.fn()}
        activeFilters={['range']}
        onActiveFiltersChange={vi.fn()}
        onCommit={onCommit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Период/ }));
    const checkbox = screen.getByRole('checkbox', { name: /ввести время/i });
    expect((checkbox as HTMLInputElement).checked).toBe(false);

    fireEvent.click(checkbox);

    expect(onCommit).toHaveBeenCalled();
    const snap = onCommit.mock.calls.at(-1)?.[0];
    expect(snap.filter.range).toMatchObject({
      preset: 'today',
      timeEnabled: true,
      timeFrom: '00:00',
      timeTo: '24:00',
    });
  });
});
