import { useEffect, useRef, useState } from 'react';
import type { FilterMenuItem, FilterSpec } from './filterModel';
import styles from '../FilterChips.module.css';

interface FilterChipsProps {
  /** Все фильтры, доступные для добавления через [+]. */
  available: FilterMenuItem[];
  /** Ключи показанных плашек (порядок = порядок добавления). */
  active: string[];
  /** Описание каждой активной плашки (значения/опции/колбэк). */
  specs: Record<string, FilterSpec>;
  onAdd: (key: string) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
}

/** Открытый поповер: спец-меню `add`, ключ плашки, либо ничего. */
type OpenKey = string | null;

/**
 * Generic-плашки фильтров: [+] (меню добавления) · активные плашки со значением и поповером ·
 * [×] (сбросить все). Единый интерфейс для любых таблиц; конкретика — во входных `specs`.
 */
export function FilterChips({ available, active, specs, onAdd, onRemove, onClear }: FilterChipsProps) {
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
            {available.map((f) => {
              const on = active.includes(f.key);
              return (
                <button
                  key={f.key}
                  className={styles.option}
                  onClick={() => (on ? onRemove(f.key) : onAdd(f.key))}
                >
                  <span className={styles.checkMark}>{on ? '✓' : ''}</span>
                  {f.name}
                </button>
              );
            })}
            {available.length === 0 && <span className={styles.hint}>Нет фильтров</span>}
          </div>
        )}
      </div>

      {active.map((key) => {
        const spec = specs[key];
        if (!spec) {
          return null;
        }
        const value = summarize(spec);
        const isOpen = open === key;
        return (
          <div className={styles.chipWrap} key={key}>
            <div className={[styles.chip, value || isOpen ? styles.chipActive : ''].filter(Boolean).join(' ')}>
              <button className={styles.chipBody} onClick={() => toggleOpen(key)} aria-expanded={isOpen}>
                <span className={styles.chipName}>{spec.name}</span>
                {value && <span className={styles.chipValue}>: {value}</span>}
                <span className={[styles.caret, isOpen ? styles.caretOpen : ''].join(' ')}>▾</span>
              </button>
              <button
                className={styles.chipClose}
                onClick={() => {
                  onRemove(key);
                  setOpen(null);
                }}
                title="Убрать фильтр"
                aria-label={`Убрать фильтр «${spec.name}»`}
              >
                ×
              </button>
            </div>

            {isOpen && (
              <div className={styles.popover}>
                {spec.mode === 'single'
                  ? <SingleOptions spec={spec} onPick={() => setOpen(null)} />
                  : <MultiOptions spec={spec} />}
              </div>
            )}
          </div>
        );
      })}

      <button
        className={styles.iconBtn}
        onClick={() => {
          onClear();
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

/** Сводка значения плашки для показа рядом с именем (нейтральный id '' пропускается). */
function summarize(spec: FilterSpec): string | undefined {
  const labels = spec.selected
    .filter((id) => id !== '')
    .map((id) => spec.options.find((o) => o.id === id)?.label ?? id);
  return labels.length > 0 ? labels.join(', ') : undefined;
}

function SingleOptions({ spec, onPick }: { spec: FilterSpec; onPick: () => void }) {
  const current = spec.selected[0] ?? '';
  return (
    <>
      {spec.options.map((o) => (
        <button
          key={o.id}
          className={[styles.option, current === o.id ? styles.optionActive : ''].filter(Boolean).join(' ')}
          onClick={() => {
            spec.onChange([o.id]);
            onPick();
          }}
        >
          <span className={styles.radio}>{current === o.id ? '●' : '○'}</span>
          {o.label}
        </button>
      ))}
    </>
  );
}

function MultiOptions({ spec }: { spec: FilterSpec }) {
  const selected = new Set(spec.selected);
  return (
    <>
      {spec.options.map((o) => (
        <label key={o.id} className={styles.check}>
          <input
            type="checkbox"
            checked={selected.has(o.id)}
            onChange={(e) => {
              const next = new Set(selected);
              if (e.target.checked) {
                next.add(o.id);
              } else {
                next.delete(o.id);
              }
              spec.onChange([...next]);
            }}
          />
          {o.label}
          {o.count !== undefined && <span className={styles.hint}>{o.count}</span>}
        </label>
      ))}
    </>
  );
}
