import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SettingsIcon } from './icons';
import styles from './SettingsMenu.module.css';

export interface SettingsMenuItem {
  key: string;
  label: string;
  checked: boolean;
  /** Без onChange — резерв (чекбокс без эффекта). */
  onChange?: (checked: boolean) => void;
}

export interface SettingsMenuSection {
  title: string;
  items: readonly SettingsMenuItem[];
}

interface Props {
  sections: readonly SettingsMenuSection[];
  /** aria-label / title кнопки. */
  label?: string;
  className?: string;
}

/**
 * Общая кнопка настроек + поповер с секциями чекбоксов
 * (карточка провайдера, NC, модалки).
 */
export function SettingsMenu({
  sections,
  label = 'Настройки',
  className,
}: Props) {
  const btnId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; right: number } | null>(null);

  const place = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setBox({ top: r.bottom + 6, right: window.innerWidth - r.right });
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    const onReposition = () => place();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className={[styles.wrap, className].filter(Boolean).join(' ')}>
      <button
        ref={btnRef}
        id={btnId}
        type="button"
        className={[styles.btn, open ? styles.btnActive : ''].filter(Boolean).join(' ')}
        title={label}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        <SettingsIcon className={styles.icon} />
      </button>

      {open &&
        box &&
        createPortal(
          <div
            ref={popRef}
            className={styles.popover}
            role="menu"
            aria-label={label}
            style={{
              position: 'fixed',
              top: box.top,
              right: box.right,
            }}
          >
            {sections.map((sec) => (
              <div key={sec.title} className={styles.section}>
                <span className={styles.sectionTitle}>{sec.title}</span>
                {sec.items.map((item) => {
                  const interactive = item.onChange != null;
                  return (
                    <label
                      key={item.key}
                      className={[styles.check, interactive ? '' : styles.checkDisabled]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <input
                        type="checkbox"
                        checked={item.checked}
                        disabled={!interactive}
                        onChange={
                          interactive ? (e) => item.onChange!(e.target.checked) : undefined
                        }
                      />
                      {item.label}
                    </label>
                  );
                })}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
