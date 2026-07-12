import type { ReactNode } from 'react';
import { FilterSearch } from './FilterSearch';
import styles from '../FilterBar.module.css';

interface FilterBarProps {
  /** Плашки-фильтры (обычно <FilterChips/>). */
  children: ReactNode;
  /** Счётчик «Найдено: N» (опционально). */
  total?: number;
  /** Поле поиска (опционально). */
  search?: { initial?: string; placeholder?: string; onSearch: (query: string) => void };
}

/**
 * Generic-панель фильтров таблицы: слева плашки, справа счётчик «Найдено» и поиск.
 * Единый интерфейс для панели провайдеров и раздела «Биржи».
 */
export function FilterBar({ children, total, search }: FilterBarProps) {
  return (
    <div className={styles.bar}>
      {children}
      <div className={styles.right}>
        {total !== undefined && <span className={styles.total}>Найдено: {total}</span>}
        {search && <FilterSearch {...search} />}
      </div>
    </div>
  );
}
