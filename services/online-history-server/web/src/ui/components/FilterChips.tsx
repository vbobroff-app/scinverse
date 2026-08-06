import { useMemo } from 'react';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import type { FilterKey, SelectionScope } from '../../core/types';
import { FilterChips as GenericFilterChips } from './filters/FilterChips';
import type { FilterMenuItem, FilterSpec } from './filters/filterModel';

const AVAILABLE: FilterMenuItem[] = [
  { key: 'instruments', name: 'Инструмент' },
  { key: 'selection', name: 'Выбор' },
  { key: 'exchanges', name: 'Биржи' },
  { key: 'baskets', name: 'Наборы' },
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

interface FilterChipsProps {
  /** Открыть модалку набора: null = создать, id = правка static. */
  onManageBasket?: (basketId: number | null) => void;
}

/**
 * Плашки фильтров каталога инструментов (панель провайдеров) — тонкий адаптер над generic-плашками:
 * маппит состояние {@link useOhsStore} в описания фильтров (Инструмент/Выбор/Биржи/Наборы).
 */
export function FilterChips({ onManageBasket }: FilterChipsProps) {
  const store = useOhsStore();
  const active = useBehavior(store.activeFilters$);
  const query = useBehavior(store.instrumentQuery$);
  const selectedCount = useBehavior(store.selectedInstruments$).size;
  const selectionScope = useBehavior(store.selectionScope$);
  const baskets = useBehavior(store.baskets$);

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
        applyScope: {
          label: 'Применить',
          options: [
            { id: 'all', label: 'ко всем' },
            { id: 'base', label: 'только к БА' },
          ],
          selected: selectionScope,
          onChange: (id) => store.setSelectionScope(id as SelectionScope),
        },
      },
      exchanges: {
        key: 'exchanges',
        name: 'Биржи',
        mode: 'multi',
        options: EXCHANGES,
        selected: query.exchanges ?? [],
        onChange: (sel) => store.setExchanges(sel),
      },
      baskets: {
        key: 'baskets',
        name: 'Наборы',
        mode: 'multi',
        removeOnly: true,
        options: baskets.map((b) => {
          const isHasData = b.systemId === 'has_data';
          return {
            id: String(b.basketId),
            label: b.name,
            count: b.kind === 'static' ? b.memberCount : undefined,
            disabled: isHasData,
            title: isHasData ? 'скоро' : undefined,
          };
        }),
        selected: baskets.filter((b) => b.enabled).map((b) => String(b.basketId)),
        onChange: (sel) => store.setBasketEnabledSelection(sel),
        footerActions: onManageBasket
          ? [{ label: 'Создать набор…', onClick: () => onManageBasket(null) }]
          : undefined,
        optionActions: onManageBasket
          ? Object.fromEntries(
              baskets
                .filter((b) => b.kind === 'static')
                .map((b) => [
                  String(b.basketId),
                  {
                    label: `Изменить «${b.name}»`,
                    title: 'Изменить набор',
                    onClick: () => onManageBasket(b.basketId),
                  },
                ]),
            )
          : undefined,
      },
    }),
    [query, selectedCount, selectionScope, store, baskets, onManageBasket],
  );

  return (
    <GenericFilterChips
      available={AVAILABLE}
      active={active}
      specs={specs}
      onAdd={(k) => {
        store.addFilter(k as FilterKey);
        if (k === 'baskets') {
          store.refreshBaskets();
        }
      }}
      onRemove={(k) => store.removeFilter(k as FilterKey)}
      onClear={() => store.clearFilters()}
    />
  );
}
