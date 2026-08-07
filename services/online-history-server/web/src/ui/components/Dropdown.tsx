import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { ArrowDropDownIcon, ArrowDropUpIcon } from './icons';
import styles from './Dropdown.module.css';

const CLOSE_MS = 160;

export interface DropdownOption<T extends string = string> {
  value: T;
  label: string;
}

interface Props<T extends string = string> {
  value: T;
  options: readonly DropdownOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
}

/**
 * Общий выпадающий список (вместо native select).
 * Рамка как у search; без системного focus-visible; меню с тенью и лёгкой анимацией.
 */
export function Dropdown<T extends string = string>({
  value,
  options,
  onChange,
  disabled = false,
  className,
  id,
  'aria-label': ariaLabel,
}: Props<T>) {
  const autoId = useId();
  const listId = `${id ?? autoId}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const closeTimer = useRef<number | null>(null);

  const [present, setPresent] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [menuBox, setMenuBox] = useState<{ top: number; left: number; width: number } | null>(null);

  const selected = options.find((o) => o.value === value) ?? options[0];
  const selectedIdx = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  const placeMenu = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMenuBox({ top: r.bottom + 4, left: r.left, width: r.width });
  };

  const openMenu = () => {
    if (disabled) return;
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    placeMenu();
    setPresent(true);
    setActiveIdx(selectedIdx);
    requestAnimationFrame(() => setOpen(true));
  };

  const closeMenu = () => {
    setOpen(false);
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setPresent(false);
      setMenuBox(null);
      closeTimer.current = null;
    }, CLOSE_MS);
  };

  const toggle = () => {
    if (open) closeMenu();
    else openMenu();
  };

  useLayoutEffect(() => {
    if (!present) return;
    placeMenu();
  }, [present]);

  useEffect(() => {
    if (!present) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      closeMenu();
    };
    const onReposition = () => placeMenu();
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [present]);

  useEffect(
    () => () => {
      if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  const pick = (next: T) => {
    onChange(next);
    closeMenu();
    triggerRef.current?.focus();
  };

  const onTriggerKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        const opt = options[activeIdx];
        if (opt) pick(opt.value);
      } else {
        setActiveIdx((i) => Math.min(options.length - 1, (i < 0 ? selectedIdx : i) + 1));
      }
    } else if (e.key === 'Escape' && present) {
      e.preventDefault();
      closeMenu();
    } else if (open && e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, (i < 0 ? selectedIdx : i) - 1));
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Стрелки/Enter с триггера уже в onTriggerKey — здесь ловим Esc и навигацию с меню.
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  return (
    <div ref={rootRef} className={[styles.root, className].filter(Boolean).join(' ')}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className={[styles.trigger, open ? styles.triggerOpen : ''].filter(Boolean).join(' ')}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={present ? listId : undefined}
        aria-label={ariaLabel}
        onClick={toggle}
        onKeyDown={onTriggerKey}
      >
        <span className={styles.label}>{selected?.label ?? ''}</span>
        {open ? (
          <ArrowDropUpIcon className={styles.caret} />
        ) : (
          <ArrowDropDownIcon className={styles.caret} />
        )}
      </button>

      {present &&
        menuBox &&
        createPortal(
          <ul
            ref={menuRef}
            id={listId}
            className={[styles.menu, open ? styles.menuOpen : ''].filter(Boolean).join(' ')}
            role="listbox"
            aria-activedescendant={
              activeIdx >= 0 ? `${listId}-opt-${activeIdx}` : undefined
            }
            style={{
              position: 'fixed',
              top: menuBox.top,
              left: menuBox.left,
              width: menuBox.width,
            }}
          >
            {options.map((opt, i) => {
              const isSelected = opt.value === value;
              const isActive = i === activeIdx;
              return (
                <li key={opt.value === '' ? `__empty-${i}` : opt.value} role="presentation">
                  <button
                    type="button"
                    id={`${listId}-opt-${i}`}
                    role="option"
                    aria-selected={isSelected}
                    className={[
                      styles.option,
                      isSelected ? styles.optionSelected : '',
                      isActive ? styles.optionActive : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => pick(opt.value)}
                  >
                    {opt.label}
                  </button>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}
