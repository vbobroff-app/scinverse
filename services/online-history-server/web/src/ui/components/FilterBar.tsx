import { useEffect, useRef, useState } from 'react';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { FilterChips } from './FilterChips';
import styles from './FilterBar.module.css';

export function FilterBar() {
  const store = useOhsStore();
  const query = useBehavior(store.instrumentQuery$);
  const total = useBehavior(store.instrumentsTotal$);

  const [text, setText] = useState(query.q ?? '');
  const debounced = useDebouncedValue(text, 300);
  const firstRun = useRef(true);

  useEffect(() => {
    // Не дёргаем фильтр на первом рендере (стартовая загрузка уже прошла).
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    store.setInstrumentFilter({ q: debounced || undefined });
  }, [debounced, store]);

  return (
    <div className={styles.bar}>
      <FilterChips />

      <div className={styles.right}>
        <span className={styles.total}>Найдено: {total}</span>
        <div className={styles.searchWrap}>
          <svg className={styles.searchIcon} viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              d="M7 2a5 5 0 1 1 0 10A5 5 0 0 1 7 2Zm3.5 8.5L14 14"
            />
          </svg>
          <input
            className={styles.search}
            placeholder="Поиск…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
