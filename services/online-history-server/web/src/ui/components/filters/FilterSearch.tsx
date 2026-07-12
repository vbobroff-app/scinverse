import { useEffect, useRef, useState } from 'react';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import styles from '../FilterBar.module.css';

interface FilterSearchProps {
  initial?: string;
  placeholder?: string;
  /** Вызывается с debounce-значением строки поиска (первый рендер пропускается). */
  onSearch: (query: string) => void;
}

/** Поле поиска с debounce (300 мс). Общий для всех таблиц. */
export function FilterSearch({ initial, placeholder = 'Поиск…', onSearch }: FilterSearchProps) {
  const [text, setText] = useState(initial ?? '');
  const debounced = useDebouncedValue(text, 300);

  // onSearch держим в ref, чтобы эффект зависел только от debounced (без лишних срабатываний).
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    onSearchRef.current(debounced);
  }, [debounced]);

  return (
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
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </div>
  );
}
