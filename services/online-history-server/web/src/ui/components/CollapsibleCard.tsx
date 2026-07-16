import { useState, type ReactNode } from 'react';
import styles from './CollapsibleCard.module.css';

interface Props {
  /** Заголовок секции (напр. название метода API). */
  title: string;
  /** Необязательный технический подзаголовок (напр. `AssetsService/Schedule`). */
  subtitle?: string;
  /** Раскрыта ли секция при первом рендере. */
  defaultOpen?: boolean;
  /** Необязательный контент справа в шапке (бейджи/статус). Не перехватывает клик по шапке. */
  right?: ReactNode;
  children: ReactNode;
}

/**
 * Сворачиваемая карточка-секция. Используется для группировки операций API в рабочей области:
 * методов может быть много, поэтому каждый — отдельная секция, которую можно свернуть.
 */
export function CollapsibleCard({ title, subtitle, defaultOpen = false, right, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={styles.card}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span className={[styles.chevron, open ? styles.chevronOpen : ''].filter(Boolean).join(' ')}>▴</span>
          <span className={styles.title}>{title}</span>
          {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        </button>
        {right && <div className={styles.right}>{right}</div>}
      </header>
      {open && <div className={styles.body}>{children}</div>}
    </section>
  );
}
