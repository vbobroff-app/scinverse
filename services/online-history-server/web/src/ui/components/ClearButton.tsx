import type { ButtonHTMLAttributes } from 'react';
import { XIcon } from './icons';
import styles from './ClearButton.module.css';

type Size = 'sm' | 'md';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** sm — поле поиска; md — хедер модалки / ConfirmDialog. */
  size?: Size;
  /** aria-label и title (если title не передан отдельно). */
  label?: string;
}

/** Общий крестик Clear/Close: stroke SVG, без фона на hover. */
export function ClearButton({
  size = 'md',
  label = 'Очистить',
  className,
  title,
  type = 'button',
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={[styles.btn, size === 'sm' ? styles.sm : styles.md, className]
        .filter(Boolean)
        .join(' ')}
      aria-label={label}
      title={title ?? label}
      {...rest}
    >
      <XIcon className={size === 'sm' ? styles.iconSm : styles.iconMd} />
    </button>
  );
}
