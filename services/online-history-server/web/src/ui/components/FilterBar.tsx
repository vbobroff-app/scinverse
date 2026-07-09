import { useEffect, useRef, useState } from 'react';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import styles from './FilterBar.module.css';

const SEC_TYPES = ['SHARE', 'FUT', 'OPT', 'BOND', 'CURRENCY'];

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
      <input
        className={styles.search}
        placeholder="Поиск по тикеру или названию…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <select
        className={styles.select}
        value={query.secType ?? ''}
        onChange={(e) => store.setInstrumentFilter({ secType: e.target.value || undefined })}
      >
        <option value="">Все типы</option>
        {SEC_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

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
