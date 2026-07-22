import type { NotificationSeverity } from '@scinverse/notification-center';
import { SeverityIcon } from '@scinverse/notification-center';
import { Button } from './Button';
import styles from './ConfirmDialog.module.css';

/** Типы message box: info / warning / error (из NC). */
export type MessageBoxSeverity = Extract<NotificationSeverity, 'info' | 'warning' | 'error'>;

interface Props {
  title: string;
  message: string;
  /** Иконка в header. По умолчанию info; `danger` без severity → error. */
  severity?: MessageBoxSeverity;
  confirmLabel?: string;
  /** `null` / без `onCancel` — режим alert (только ОК). */
  cancelLabel?: string | null;
  danger?: boolean;
  /** Опциональный чекбокс между сообщением и кнопками (напр. «Больше не показывать»). */
  checkbox?: { label: string; checked: boolean; onChange: (checked: boolean) => void };
  onConfirm: () => void;
  onCancel?: () => void;
}

export function ConfirmDialog({
  title,
  message,
  severity,
  confirmLabel = 'ОК',
  cancelLabel = 'Отмена',
  danger = false,
  checkbox,
  onConfirm,
  onCancel,
}: Props) {
  const tone: MessageBoxSeverity = severity ?? (danger ? 'error' : 'info');
  const showCancel = onCancel != null && cancelLabel != null;

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        e.stopPropagation();
        if (showCancel) onCancel?.();
      }}
      role="presentation"
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="msgbox-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.head}>
          <SeverityIcon severity={tone} />
          <h4 id="msgbox-title" className={styles.title}>
            {title}
          </h4>
        </header>
        <p className={styles.message}>{message}</p>
        {checkbox && (
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={checkbox.checked}
              onChange={(e) => checkbox.onChange(e.target.checked)}
            />
            {checkbox.label}
          </label>
        )}
        <div className={styles.actions}>
          <Button variant={danger || tone === 'error' ? 'danger' : 'primary'} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </Button>
          {showCancel && <Button onClick={onCancel}>{cancelLabel}</Button>}
        </div>
      </div>
    </div>
  );
}
