import { useEffect, useRef, useState } from 'react';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import type { FilterKey, SelectionCondition } from '../../core/types';
import styles from './FilterChips.module.css';

interface FilterDef {
  key: FilterKey;
  name: string;
}

const FILTER_DEFS: FilterDef[] = [
  { key: 'instruments', name: 'Инструмент' },
  { key: 'selection', name: 'Выбор' },
  { key: 'exchanges', name: 'Биржи' },
];

const CATEGORIES: { id: string; label: string }[] = [
  { id: '', label: 'Все инструменты' },
  { id: 'futures', label: 'Фьючерсы' },
  { id: 'shares', label: 'Акции' },
  { id: 'currency', label: 'Валюта' },
  { id: 'bonds', label: 'Облигации' },
  { id: 'index', label: 'Индексы' },
];

const SELECTION_ITEMS: { id: SelectionCondition; label: string }[] = [
  { id: 'recording', label: 'Запущенные' },
  { id: 'nonEmpty', label: 'Не пустые' },
  { id: 'selected', label: 'Выделенные' },
];

const EXCHANGES: { id: string; label: string }[] = [{ id: 'MOEX', label: 'MOEX' }];

/** Открытый поповер: ключ плашки, спец-меню добавления `add`, либо ничего. */
type OpenKey = FilterKey | 'add' | null;

export function FilterChips() {
  const store = useOhsStore();
  const active = useBehavior(store.activeFilters$);
  const query = useBehavior(store.instrumentQuery$);
  const selectedCount = useBehavior(store.selectedInstruments$).size;

  const [open, setOpen] = useState<OpenKey>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open === null) {
      return;
    }
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(null);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggleOpen = (key: OpenKey) => setOpen((cur) => (cur === key ? null : key));

  const categoryLabel = CATEGORIES.find((c) => c.id === (query.category ?? ''))?.label;
  const selectionLabels = SELECTION_ITEMS.filter((s) =>
    s.id === 'recording'
      ? query.onlyRecording
      : s.id === 'nonEmpty'
        ? query.nonEmpty
        : query.instrumentIds !== undefined,
  ).map((s) => s.label);

  const chipLabel = (key: FilterKey): { name: string; value?: string } => {
    const name = FILTER_DEFS.find((f) => f.key === key)!.name;
    if (key === 'instruments') {
      return { name, value: query.category ? categoryLabel : undefined };
    }
    if (key === 'selection') {
      return { name, value: selectionLabels.length > 0 ? selectionLabels.join(', ') : undefined };
    }
    return { name, value: query.exchanges?.length ? query.exchanges.join(', ') : undefined };
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <div className={styles.chipWrap}>
        <button
          className={[styles.iconBtn, open === 'add' ? styles.iconBtnActive : ''].filter(Boolean).join(' ')}
          onClick={() => toggleOpen('add')}
          title="Добавить фильтр"
          aria-label="Добавить фильтр"
        >
          +
        </button>
        {open === 'add' && (
          <div className={styles.popover}>
            {FILTER_DEFS.map((f) => {
              const on = active.includes(f.key);
              return (
                <button
                  key={f.key}
                  className={styles.option}
                  onClick={() => (on ? store.removeFilter(f.key) : store.addFilter(f.key))}
                >
                  <span className={styles.checkMark}>{on ? '✓' : ''}</span>
                  {f.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {active.map((key) => {
        const { name, value } = chipLabel(key);
        const isOpen = open === key;
        return (
          <div className={styles.chipWrap} key={key}>
            <div
              className={[styles.chip, value || isOpen ? styles.chipActive : ''].filter(Boolean).join(' ')}
            >
              <button className={styles.chipBody} onClick={() => toggleOpen(key)} aria-expanded={isOpen}>
                <span className={styles.chipName}>{name}</span>
                {value && <span className={styles.chipValue}>: {value}</span>}
                <span className={[styles.caret, isOpen ? styles.caretOpen : ''].join(' ')}>▾</span>
              </button>
              <button
                className={styles.chipClose}
                onClick={() => {
                  store.removeFilter(key);
                  setOpen(null);
                }}
                title="Убрать фильтр"
                aria-label={`Убрать фильтр «${name}»`}
              >
                ×
              </button>
            </div>

            {isOpen && key === 'instruments' && (
              <div className={styles.popover}>
                {CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    className={[styles.option, (query.category ?? '') === c.id ? styles.optionActive : '']
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => {
                      store.setCategory(c.id || undefined);
                      setOpen(null);
                    }}
                  >
                    <span className={styles.radio}>{(query.category ?? '') === c.id ? '●' : '○'}</span>
                    {c.label}
                  </button>
                ))}
              </div>
            )}

            {isOpen && key === 'selection' && (
              <div className={styles.popover}>
                {SELECTION_ITEMS.map((s) => {
                  const checked =
                    s.id === 'recording'
                      ? Boolean(query.onlyRecording)
                      : s.id === 'nonEmpty'
                        ? Boolean(query.nonEmpty)
                        : query.instrumentIds !== undefined;
                  return (
                    <label key={s.id} className={styles.check}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const cur = store.selectionConditions();
                          store.setSelectionConditions({ ...cur, [s.id]: e.target.checked });
                        }}
                      />
                      {s.label}
                      {s.id === 'selected' && <span className={styles.hint}>{selectedCount}</span>}
                    </label>
                  );
                })}
              </div>
            )}

            {isOpen && key === 'exchanges' && (
              <div className={styles.popover}>
                {EXCHANGES.map((x) => {
                  const set = new Set(query.exchanges ?? []);
                  const checked = set.has(x.id);
                  return (
                    <label key={x.id} className={styles.check}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = new Set(query.exchanges ?? []);
                          if (e.target.checked) {
                            next.add(x.id);
                          } else {
                            next.delete(x.id);
                          }
                          store.setExchanges([...next]);
                        }}
                      />
                      {x.label}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <button
        className={styles.iconBtn}
        onClick={() => {
          store.clearFilters();
          setOpen(null);
        }}
        disabled={active.length === 0}
        title="Сбросить все фильтры"
        aria-label="Сбросить все фильтры"
      >
        ×
      </button>
    </div>
  );
}
