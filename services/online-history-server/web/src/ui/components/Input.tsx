import type { InputHTMLAttributes } from 'react';
import styles from './Field.module.css';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  type?: 'text' | 'search' | 'email' | 'url' | 'password' | 'number';
}

/** Общий однострочный input: рамка как у search / Dropdown, без системного focus-visible. */
export function Input({ className, type = 'text', ...rest }: Props) {
  return (
    <input
      type={type}
      className={[styles.field, styles.input, className].filter(Boolean).join(' ')}
      {...rest}
    />
  );
}
