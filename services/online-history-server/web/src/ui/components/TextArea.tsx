import type { TextareaHTMLAttributes } from 'react';
import styles from './Field.module.css';

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Моноширинный шрифт (glob, код и т.п.). */
  mono?: boolean;
  /** Красная рамка после неуспешной валидации. */
  invalid?: boolean;
}

/** Общий textarea: рамка как у search / Dropdown, без системного focus-visible. */
export function TextArea({ className, mono = false, invalid = false, ...rest }: Props) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={[
        styles.field,
        styles.textarea,
        mono ? styles.mono : '',
        invalid ? styles.invalid : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  );
}
