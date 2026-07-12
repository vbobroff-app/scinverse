import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { FilterBar as GenericFilterBar } from './filters/FilterBar';
import { FilterChips } from './FilterChips';

/**
 * Панель фильтров каталога инструментов (панель провайдеров): плашки Инструмент/Выбор/Биржи +
 * счётчик «Найдено» и поиск. Тонкий адаптер над generic-панелью поверх {@link useOhsStore}.
 */
export function FilterBar() {
  const store = useOhsStore();
  const total = useBehavior(store.instrumentsTotal$);

  return (
    <GenericFilterBar
      total={total}
      search={{
        initial: store.instrumentQuery$.value.q ?? '',
        onSearch: (q) => store.setInstrumentFilter({ q: q || undefined }),
      }}
    >
      <FilterChips />
    </GenericFilterBar>
  );
}
