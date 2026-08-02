import { Tip, createOffsetFormatTs, formatTsUtc } from '@scinverse/notification-center';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OhsApi } from '../../core/api';
import type { IncidentDto } from '../../core/types';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { formatDurationMs } from '../pages/formatDurationMs';
import { EyeIcon, PencilIcon } from './icons';
import styles from './ConnectionIncidentsModal.module.css';

interface Props {
  connectionId: number;
  connectionName: string;
  open: boolean;
  onClose: () => void;
}

type CloseStep = 'reason' | 'confirm';

function isOpenStatus(status: string): boolean {
  return status === 'active' || status === 'recovering';
}

function statusClass(status: string): string {
  if (status === 'active') return styles.badgeActive;
  if (status === 'recovering') return styles.badgeRecovering;
  if (status === 'resolved') return styles.badgeResolved;
  return styles.badge;
}

/** Тултип исхода при ручном закрытии: комментарий из модалки. */
function manualCloseTip(row: IncidentDto): string | null {
  if (row.closeOutcome !== 'abandoned_manual') return null;
  const note = row.closeNote?.trim();
  return note ? `Закрыто пользователем: ${note}` : 'Закрыто пользователем';
}

function closeConsequence(status: string): string {
  if (status === 'recovering') {
    return 'Закрытие инцидента во время восстановления. Режим AUTO будет отключён. Повторные попытки супервизора по этому эпизоду не продолжатся.';
  }
  return 'По этому инциденту попытки восстановления приниматься не будут.';
}

/**
 * Модалка журнала инцидентов текущего connection: просмотр таблицы,
 * в edit — Закрыть (wizard reason→confirm) / Удалить (заглушка).
 */
export function ConnectionIncidentsModal({
  connectionId,
  connectionName,
  open,
  onClose,
}: Props) {
  const store = useOhsStore();
  const tz = useBehavior(store.displayTz$);
  const formatTs = useMemo(
    () => (tz.offsetMin === 0 ? formatTsUtc : createOffsetFormatTs(tz.offsetMin)),
    [tz.offsetMin],
  );

  const [editing, setEditing] = useState(false);
  const [items, setItems] = useState<IncidentDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCorr, setSelectedCorr] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeStep, setCloseStep] = useState<CloseStep>('reason');
  /** Анимация входа reason только при возврате с confirm. */
  const [reasonStepIn, setReasonStepIn] = useState(false);
  const [closeNote, setCloseNote] = useState('');
  const [resolving, setResolving] = useState(false);
  const closeDialogRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => (selectedCorr ? (items.find((i) => i.corrUid === selectedCorr) ?? null) : null),
    [items, selectedCorr],
  );
  const canClose = editing && selected != null && isOpenStatus(selected.status);

  const unlockCloseDialogSize = useCallback(() => {
    const el = closeDialogRef.current;
    if (!el) return;
    el.style.minHeight = '';
    el.style.height = '';
  }, []);

  const resetCloseWizard = useCallback(() => {
    setCloseOpen(false);
    setCloseStep('reason');
    setReasonStepIn(false);
    setCloseNote('');
    unlockCloseDialogSize();
  }, [unlockCloseDialogSize]);

  /** Зафиксировать размер бокса (reason → confirm без прыжка высоты). */
  const goCloseConfirm = useCallback(() => {
    const el = closeDialogRef.current;
    if (el) {
      const h = Math.ceil(el.getBoundingClientRect().height);
      el.style.minHeight = `${h}px`;
      el.style.height = `${h}px`;
    }
    setReasonStepIn(false);
    setCloseStep('confirm');
  }, []);

  const goCloseReason = useCallback(() => {
    unlockCloseDialogSize();
    setReasonStepIn(true);
    setCloseStep('reason');
  }, [unlockCloseDialogSize]);

  const reload = useCallback(() => {
    setError(null);
    const sub = OhsApi.getIncidents({
      module: 'connection',
      connectionId,
      limit: 200,
    }).subscribe({
      next: (list) => {
        setItems(list);
        setLoaded(true);
        setSelectedCorr((cur) =>
          cur && list.some((i) => i.corrUid === cur) ? cur : null,
        );
      },
      error: (err: unknown) => {
        setLoaded(true);
        setError(err instanceof Error ? err.message : 'Не удалось загрузить журнал');
      },
    });
    return () => sub.unsubscribe();
  }, [connectionId]);

  useEffect(() => {
    if (!open) return;
    setEditing(false);
    resetCloseWizard();
    setLoaded(false);
    setSelectedCorr(null);
    return reload();
  }, [open, reload, resetCloseWizard]);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      if (closeOpen) {
        if (closeStep === 'confirm' && !resolving) {
          goCloseReason();
          return;
        }
        if (!resolving) resetCloseWizard();
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeOpen, closeStep, resolving, onClose, resetCloseWizard, goCloseReason]);

  if (!open) return null;

  const submitClose = () => {
    if (!selected) return;
    const wasRecovering = selected.status === 'recovering';
    setResolving(true);
    setError(null);
    const note = closeNote.trim();
    OhsApi.resolveIncident(selected.corrUid, {
      resolvedBy: 'superuser',
      closeNote: note || null,
    }).subscribe({
      next: () => {
        setResolving(false);
        resetCloseWizard();
        reload();
        store.refreshLiveness();
        if (wasRecovering) {
          store.refreshConnectionSchedule(connectionId);
        }
      },
      error: (err: unknown) => {
        setResolving(false);
        setError(err instanceof Error ? err.message : 'Не удалось закрыть инцидент');
      },
    });
  };

  const reasonTitle =
    selected?.status === 'recovering'
      ? 'Закрыть инцидент (отключит AUTO)'
      : 'Закрыть инцидент';

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !closeOpen) onClose();
      }}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={`Журнал инцидентов · ${connectionName}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.head}>
          <strong className={styles.headTitle}>
            Журнал инцидентов · {connectionName}
          </strong>
          <div className={styles.headActions}>
            <Tip content={editing ? 'Режим редактирования' : 'Режим просмотра'}>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => {
                  setEditing((v) => !v);
                  resetCloseWizard();
                }}
                aria-pressed={editing}
              >
                {editing ? (
                  <PencilIcon className={styles.headIcon} />
                ) : (
                  <EyeIcon className={styles.headIcon} />
                )}
              </button>
            </Tip>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onClose}
              aria-label="Закрыть"
            >
              <span className={styles.closeGlyph} aria-hidden="true">
                ×
              </span>
            </button>
          </div>
        </header>

        {editing ? (
          <div className={styles.toolbar}>
            <button
              type="button"
              className={[styles.actionBtn, styles.actionBtnPrimary].join(' ')}
              disabled={!canClose || resolving}
              onClick={() => {
                setCloseNote('');
                setCloseStep('reason');
                setReasonStepIn(false);
                unlockCloseDialogSize();
                setCloseOpen(true);
              }}
            >
              Закрыть
            </button>
            <button
              type="button"
              className={styles.actionBtn}
              disabled
              title="скоро"
            >
              Удалить
            </button>
            <span className={styles.toolbarSpacer} />
            {!canClose && selected ? (
              <span className={styles.error} style={{ color: 'var(--color-text-muted)' }}>
                Закрыть можно только open-эпизод
              </span>
            ) : null}
          </div>
        ) : null}

        {error ? <div className={styles.error}>{error}</div> : null}

        <div className={styles.tableWrap}>
          {!loaded ? (
            <div className={styles.empty}>Загрузка…</div>
          ) : items.length === 0 ? (
            <div className={styles.empty}>Нет инцидентов</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Открыт</th>
                  <th>Статус</th>
                  <th>Тип</th>
                  <th>Заголовок</th>
                  <th>Длит.</th>
                  <th>Исход</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const closeTip = manualCloseTip(row);
                  const outcome = row.closeOutcome ?? '—';
                  return (
                    <tr
                      key={row.corrUid}
                      className={selectedCorr === row.corrUid ? styles.rowActive : undefined}
                      onClick={() => setSelectedCorr(row.corrUid)}
                    >
                      <td className={styles.mono}>{formatTs(row.openedAt)}</td>
                      <td>
                        <span className={statusClass(row.status)}>{row.status}</span>
                      </td>
                      <td>{row.type}</td>
                      <td className={styles.titleCell}>{row.title || row.subject}</td>
                      <td className={styles.mono}>{formatDurationMs(row.durationMs)}</td>
                      <td>
                        {closeTip ? (
                          <Tip content={closeTip}>
                            <span className={styles.outcomeTip}>{outcome}</span>
                          </Tip>
                        ) : (
                          outcome
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {closeOpen && selected ? (
          <div
            className={styles.confirmOverlay}
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget && !resolving) resetCloseWizard();
            }}
          >
            <div
              ref={closeDialogRef}
              className={styles.confirmDialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="inc-close-title"
              onClick={(e) => e.stopPropagation()}
            >
              {closeStep === 'reason' ? (
                <div
                  key="reason"
                  className={[
                    styles.closeStep,
                    reasonStepIn ? styles.closeStepBackIn : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <h4 id="inc-close-title" className={styles.confirmTitle}>
                    {reasonTitle}
                  </h4>
                  <p className={styles.confirmMeta}>
                    {selected.type}
                    {selected.subtype ? ` · ${selected.subtype}` : ''}
                    {' · '}
                    <span className={styles.mono}>{selected.corrUid.slice(0, 8)}…</span>
                    <br />
                    открыт {formatTs(selected.openedAt)}
                    {selected.title ? (
                      <>
                        <br />
                        {selected.title}
                      </>
                    ) : null}
                  </p>
                  <label className={styles.confirmLabel}>
                    Причина закрытия
                    <input
                      className={styles.confirmInput}
                      type="text"
                      value={closeNote}
                      onChange={(e) => setCloseNote(e.target.value)}
                      placeholder="необязательно"
                      autoFocus
                      disabled={resolving}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !resolving) goCloseConfirm();
                      }}
                    />
                  </label>
                  <div className={styles.confirmActions}>
                    <button
                      type="button"
                      className={[styles.actionBtn, styles.actionBtnPrimary].join(' ')}
                      disabled={resolving}
                      onClick={goCloseConfirm}
                    >
                      ОК
                    </button>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      disabled={resolving}
                      onClick={resetCloseWizard}
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  key="confirm"
                  className={[styles.closeStep, styles.closeStepConfirm].join(' ')}
                >
                  <h4 id="inc-close-title" className={styles.confirmTitle}>
                    Подтвердить ручное закрытие
                  </h4>
                  <p className={styles.confirmWarn}>{closeConsequence(selected.status)}</p>
                  {closeNote.trim() ? (
                    <p className={styles.confirmMeta}>
                      Причина: {closeNote.trim()}
                    </p>
                  ) : null}
                  <div className={styles.confirmActions}>
                    <button
                      type="button"
                      className={[styles.actionBtn, styles.actionBtnPrimary].join(' ')}
                      disabled={resolving}
                      onClick={submitClose}
                      autoFocus
                    >
                      {resolving ? 'Закрываю…' : 'Подтвердить'}
                    </button>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      disabled={resolving}
                      onClick={goCloseReason}
                    >
                      Назад
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
