import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

type Variant = 'primary' | 'default' | 'danger';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = 'default', className, ...rest }: Props) {
  return <button className={[styles.btn, styles[variant], className].filter(Boolean).join(' ')} {...rest} />;
}
