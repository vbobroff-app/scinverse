import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { FilterBar as GenericFilterBar } from './filters/FilterBar';
import { FilterChips } from './FilterChips';
import { CrosshairIcon, DayBoxIcon } from './icons';
import styles from './FilterBar.module.css';

/**
 * Панель фильтров каталога инструментов (панель провайдеров): плашки Инструмент/Выбор/Биржи +
 * счётчик «Найдено», тумблеры отображения Ганта и поиск. Тонкий адаптер над generic-панелью
 * поверх {@link useOhsStore}.
 */
export function FilterBar() {
  const store = useOhsStore();
  const total = useBehavior(store.instrumentsTotal$);
  const highlightDays = useBehavior(store.highlightDays$);
  const crosshairOn = useBehavior(store.crosshairOn$);

  return (
    <GenericFilterBar
      total={total}
      leadingControls={
        <div className={styles.viewToggles} role="group" aria-label="Отображение таймлайна">
          <button
            type="button"
            className={[styles.viewToggle, highlightDays ? styles.viewToggleOn : '']
              .filter(Boolean)
              .join(' ')}
            aria-pressed={highlightDays}
            title={highlightDays ? 'Не подсвечивать дни' : 'Подсвечивать дни'}
            onClick={() => store.setHighlightDays(!highlightDays)}
          >
            <DayBoxIcon className={styles.viewToggleIcon} />
          </button>
          <button
            type="button"
            className={[styles.viewToggle, crosshairOn ? styles.viewToggleOn : '']
              .filter(Boolean)
              .join(' ')}
            aria-pressed={crosshairOn}
            title={crosshairOn ? 'Выключить вертикальный time-line' : 'Включить вертикальный time-line'}
            onClick={() => store.setCrosshairOn(!crosshairOn)}
          >
            <CrosshairIcon className={styles.viewToggleIcon} />
          </button>
        </div>
      }
      search={{
        initial: store.instrumentQuery$.value.q ?? '',
        onSearch: (q) => store.setInstrumentFilter({ q: q || undefined }),
      }}
    >
      <FilterChips />
    </GenericFilterBar>
  );
}
