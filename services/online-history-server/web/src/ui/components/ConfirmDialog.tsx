import { Button } from './Button';
import styles from './ConfirmDialog.module.css';

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'ОК',
  cancelLabel = 'Отмена',
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.dialog} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h4 className={styles.title}>{title}</h4>
        <p className={styles.message}>{message}</p>
        <div className={styles.actions}>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </Button>
          <Button onClick={onCancel}>{cancelLabel}</Button>
        </div>
      </div>
    </div>
  );
}
