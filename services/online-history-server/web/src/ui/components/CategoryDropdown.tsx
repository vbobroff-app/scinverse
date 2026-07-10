import { useEffect, useRef, useState } from 'react';
import styles from './CategoryDropdown.module.css';

export interface Category {
  id: string;
  label: string;
}

interface Props {
  categories: Category[];
  value: string;
  onChange: (id: string) => void;
}

/** Заголовок-дропдаун выбора категории (Finam-стиль): «Фьючерсы ▾» + меню. */
export function CategoryDropdown({ categories, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const current = categories.find((c) => c.id === value) ?? categories[0];

  return (
    <div className={styles.root} ref={ref}>
      <button className={styles.trigger} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={styles.label}>{current.label}</span>
        <span className={styles.caret}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <ul className={styles.menu} role="listbox">
          {categories.map((c) => (
            <li key={c.id}>
              <button
                className={[styles.item, c.id === value ? styles.active : ''].filter(Boolean).join(' ')}
                onClick={() => {
                  onChange(c.id);
                  setOpen(false);
                }}
                role="option"
                aria-selected={c.id === value}
              >
                {c.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
