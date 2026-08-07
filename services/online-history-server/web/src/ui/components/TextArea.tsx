import type { TextareaHTMLAttributes } from 'react';
import styles from './Field.module.css';

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Моноширинный шрифт (glob, код и т.п.). */
  mono?: boolean;
}

/** Общий textarea: рамка как у search / Dropdown, без системного focus-visible. */
export function TextArea({ className, mono = false, ...rest }: Props) {
  return (
    <textarea
      className={[styles.field, styles.textarea, mono ? styles.mono : '', className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  );
}
