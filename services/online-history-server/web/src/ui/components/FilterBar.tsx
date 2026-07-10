import { useEffect, useRef, useState } from 'react';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { CategoryDropdown, type Category } from './CategoryDropdown';
import styles from './FilterBar.module.css';

// Категории верхнего уровня (Finam-стиль). Опционы не выделены — они внутри дерева фьючерсов.
const CATEGORIES: Category[] = [
  { id: '', label: 'Все инструменты' },
  { id: 'futures', label: 'Фьючерсы' },
  { id: 'shares', label: 'Акции' },
  { id: 'currency', label: 'Валюта' },
  { id: 'bonds', label: 'Облигации' },
  { id: 'index', label: 'Индексы' },
];

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
      <CategoryDropdown
        categories={CATEGORIES}
        value={query.category ?? ''}
        onChange={(id) => store.setInstrumentFilter({ category: id || undefined })}
      />

      <input
        className={styles.search}
        placeholder="Поиск по тикеру или названию…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={Boolean(query.onlyRecording)}
          onChange={(e) => store.setInstrumentFilter({ onlyRecording: e.target.checked })}
        />
        только запущенные
      </label>

      <span className={styles.total}>Найдено: {total}</span>
    </div>
  );
}
