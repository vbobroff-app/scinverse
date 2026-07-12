import { useMemo } from 'react';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import type { FilterKey } from '../../core/types';
import { FilterChips as GenericFilterChips } from './filters/FilterChips';
import type { FilterMenuItem, FilterSpec } from './filters/filterModel';

const AVAILABLE: FilterMenuItem[] = [
  { key: 'instruments', name: 'Инструмент' },
  { key: 'selection', name: 'Выбор' },
  { key: 'exchanges', name: 'Биржи' },
];

const CATEGORIES = [
  { id: '', label: 'Все инструменты' },
  { id: 'futures', label: 'Фьючерсы' },
  { id: 'shares', label: 'Акции' },
  { id: 'currency', label: 'Валюта' },
  { id: 'bonds', label: 'Облигации' },
  { id: 'index', label: 'Индексы' },
];

const EXCHANGES = [{ id: 'MOEX', label: 'MOEX' }];

/**
 * Плашки фильтров каталога инструментов (панель провайдеров) — тонкий адаптер над generic-плашками:
 * маппит состояние {@link useOhsStore} в описания фильтров (Инструмент/Выбор/Биржи).
 */
export function FilterChips() {
  const store = useOhsStore();
  const active = useBehavior(store.activeFilters$);
  const query = useBehavior(store.instrumentQuery$);
  const selectedCount = useBehavior(store.selectedInstruments$).size;

  const specs = useMemo<Record<string, FilterSpec>>(
    () => ({
      instruments: {
        key: 'instruments',
        name: 'Инструмент',
        mode: 'single',
        options: CATEGORIES,
        selected: query.category ? [query.category] : [''],
        onChange: (sel) => store.setCategory(sel[0] || undefined),
      },
      selection: {
        key: 'selection',
        name: 'Выбор',
        mode: 'multi',
        options: [
          { id: 'recording', label: 'Запущенные' },
          { id: 'nonEmpty', label: 'Не пустые' },
          { id: 'selected', label: 'Выделенные', count: selectedCount },
        ],
        selected: [
          query.onlyRecording ? 'recording' : '',
          query.nonEmpty ? 'nonEmpty' : '',
          query.instrumentIds !== undefined ? 'selected' : '',
        ].filter(Boolean),
        onChange: (sel) =>
          store.setSelectionConditions({
            recording: sel.includes('recording'),
            nonEmpty: sel.includes('nonEmpty'),
            selected: sel.includes('selected'),
          }),
      },
      exchanges: {
        key: 'exchanges',
        name: 'Биржи',
        mode: 'multi',
        options: EXCHANGES,
        selected: query.exchanges ?? [],
        onChange: (sel) => store.setExchanges(sel),
      },
    }),
    [query, selectedCount, store],
  );

  return (
    <GenericFilterChips
      available={AVAILABLE}
      active={active}
      specs={specs}
      onAdd={(k) => store.addFilter(k as FilterKey)}
      onRemove={(k) => store.removeFilter(k as FilterKey)}
      onClear={() => store.clearFilters()}
    />
  );
}
