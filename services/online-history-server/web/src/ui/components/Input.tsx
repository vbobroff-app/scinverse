import type { InputHTMLAttributes } from 'react';
import styles from './Field.module.css';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  type?: 'text' | 'search' | 'email' | 'url' | 'password' | 'number';
  /** Красная рамка после неуспешной валидации. */
  invalid?: boolean;
}

/** Общий однострочный input: рамка как у search / Dropdown, без системного focus-visible. */
export function Input({ className, type = 'text', invalid = false, ...rest }: Props) {
  return (
    <input
      type={type}
      aria-invalid={invalid || undefined}
      className={[styles.field, styles.input, invalid ? styles.invalid : '', className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  );
}
