import type { ReactNode } from 'react';
import { FilterSearch } from './FilterSearch';
import styles from '../FilterBar.module.css';

interface FilterBarProps {
  /** Плашки-фильтры (обычно <FilterChips/>). */
  children: ReactNode;
  /** Счётчик «Найдено: N» (опционально). */
  total?: number;
  /** Доп. контролы справа, перед счётчиком «Найдено» (напр. тумблеры отображения). */
  leadingControls?: ReactNode;
  /** Поле поиска (опционально). */
  search?: { initial?: string; placeholder?: string; onSearch: (query: string) => void };
}

/**
 * Generic-панель фильтров таблицы: слева плашки, справа доп. контролы, счётчик «Найдено» и поиск.
 * Единый интерфейс для панели провайдеров и раздела «Биржи».
 */
export function FilterBar({ children, total, leadingControls, search }: FilterBarProps) {
  return (
    <div className={styles.bar}>
      {children}
      <div className={styles.right}>
        {leadingControls}
        {total !== undefined && <span className={styles.total}>Найдено: {total}</span>}
        {search && <FilterSearch {...search} />}
      </div>
    </div>
  );
}
