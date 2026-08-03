import { Tip, createOffsetFormatTs, formatTsUtc } from '@scinverse/notification-center';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OhsApi } from '../../core/api';
import {
  loadIncidentsModalFilters,
  loadIncidentsShowDeleted,
  saveIncidentsModalFilters,
  saveIncidentsShowDeleted,
  type IncidentsModalFilterKey,
} from '../../core/incidentsJournalStorage';
import type { IncidentDto } from '../../core/types';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { formatDurationMs } from '../pages/formatDurationMs';
import { FilterChips } from './filters/FilterChips';
import type { FilterMenuItem, FilterSpec } from './filters/filterModel';
import { EyeIcon, PencilIcon } from './icons';
import styles from './ConnectionIncidentsModal.module.css';

interface Props {
  connectionId: number;
  connectionName: string;
  open: boolean;
  onClose: () => void;
}

type CloseStep = 'reason' | 'confirm';
type DeleteStep = 'info' | 'confirm';
type WizardKind = 'close' | 'delete' | null;

const PAGE_SIZE = 100;
const NEAR_END_PX = 200;

const STATUS_IDS = ['active', 'recovering', 'resolved', 'deleted'] as const;
const OUTCOME_IDS = ['recovered', 'abandoned_manual', 'recovered_manual'] as const;

const FILTER_AVAILABLE: FilterMenuItem[] = [
  { key: 'status', name: 'Статус' },
  { key: 'outcome', name: 'Исход' },
];

/** Пусто или все опции → не фильтруем (как NC: empty set = off). */
function effectiveMulti(selected: string[], allIds: readonly string[]): string[] | undefined {
  if (selected.length === 0) return undefined;
  if (allIds.every((id) => selected.includes(id))) return undefined;
  return selected;
}

function isOpenStatus(status: string): boolean {
  return status === 'active' || status === 'recovering';
}

function isDeleted(row: IncidentDto): boolean {
  return row.deletedAt != null && row.deletedAt !== '';
}

function statusClass(row: IncidentDto, deleted: boolean): string {
  if (deleted) return styles.badgeDeleted;
  if (row.status === 'active') return styles.badgeActive;
  if (row.status === 'recovering') return styles.badgeRecovering;
  if (row.status === 'resolved') {
    // Ручное закрытие — зелёный бордер; recovered — без бордера (как раньше).
    return row.closeOutcome === 'abandoned_manual'
      ? styles.badgeResolvedManual
      : styles.badgeResolved;
  }
  return styles.badge;
}

function statusLabel(row: IncidentDto): string {
  return isDeleted(row) ? 'deleted' : row.status;
}

/** Тултип исхода при ручном закрытии: комментарий из модалки. */
function manualCloseTip(row: IncidentDto): string | null {
  if (row.closeOutcome !== 'abandoned_manual') return null;
  const note = row.closeNote?.trim();
  return note ? `Закрыто пользователем: ${note}` : 'Закрыто пользователем';
}

function deletedTip(row: IncidentDto, formatTs: (iso: string) => string): string | null {
  if (!isDeleted(row) || !row.deletedAt) return null;
  const by = row.deletedBy?.trim() || 'оператор';
  return `Скрыто: ${by} · ${formatTs(row.deletedAt)}`;
}

function closeConsequence(status: string): string {
  if (status === 'recovering') {
    return 'Закрытие инцидента во время восстановления. Режим AUTO будет отключён. Повторные попытки супервизора по этому эпизоду не продолжатся.';
  }
  return 'По этому инциденту попытки восстановления приниматься не будут.';
}

/**
 * Модалка журнала инцидентов текущего connection: просмотр таблицы,
 * в edit — Закрыть (wizard) / Удалить|Восстановить (soft-delete).
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
  const [showDeleted, setShowDeleted] = useState(() => loadIncidentsShowDeleted());
  const [activeFilters, setActiveFilters] = useState<IncidentsModalFilterKey[]>(
    () => loadIncidentsModalFilters().activeFilters,
  );
  const [statuses, setStatuses] = useState<string[]>(
    () => loadIncidentsModalFilters().statuses,
  );
  const [outcomes, setOutcomes] = useState<string[]>(
    () => loadIncidentsModalFilters().outcomes,
  );
  const [items, setItems] = useState<IncidentDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCorr, setSelectedCorr] = useState<string | null>(null);
  const [wizard, setWizard] = useState<WizardKind>(null);
  const [closeStep, setCloseStep] = useState<CloseStep>('reason');
  const [deleteStep, setDeleteStep] = useState<DeleteStep>('info');
  /** Анимация входа первого шага только при возврате с confirm. */
  const [stepBackIn, setStepBackIn] = useState(false);
  const [closeNote, setCloseNote] = useState('');
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  const subRef = useRef<{ unsubscribe: () => void } | null>(null);
  const skipFilterSaveRef = useRef(false);
  const itemsRef = useRef(items);
  const totalRef = useRef(total);
  itemsRef.current = items;
  totalRef.current = total;

  const selected = useMemo(
    () => (selectedCorr ? (items.find((i) => i.corrUid === selectedCorr) ?? null) : null),
    [items, selectedCorr],
  );
  const selectedDeleted = selected != null && isDeleted(selected);
  const canClose =
    editing && selected != null && !selectedDeleted && isOpenStatus(selected.status);
  const canDelete = editing && selected != null && !selectedDeleted;
  const canRestore = editing && selected != null && selectedDeleted;

  const unlockDialogSize = useCallback(() => {
    const el = dialogRef.current;
    if (!el) return;
    el.style.minHeight = '';
    el.style.height = '';
  }, []);

  const resetWizard = useCallback(() => {
    setWizard(null);
    setCloseStep('reason');
    setDeleteStep('info');
    setStepBackIn(false);
    setCloseNote('');
    unlockDialogSize();
  }, [unlockDialogSize]);

  const lockDialogSize = useCallback(() => {
    const el = dialogRef.current;
    if (!el) return;
    const h = Math.ceil(el.getBoundingClientRect().height);
    el.style.minHeight = `${h}px`;
    el.style.height = `${h}px`;
  }, []);

  const goCloseConfirm = useCallback(() => {
    lockDialogSize();
    setStepBackIn(false);
    setCloseStep('confirm');
  }, [lockDialogSize]);

  const goCloseReason = useCallback(() => {
    unlockDialogSize();
    setStepBackIn(true);
    setCloseStep('reason');
  }, [unlockDialogSize]);

  const goDeleteConfirm = useCallback(() => {
    lockDialogSize();
    setStepBackIn(false);
    setDeleteStep('confirm');
  }, [lockDialogSize]);

  const goDeleteInfo = useCallback(() => {
    unlockDialogSize();
    setStepBackIn(true);
    setDeleteStep('info');
  }, [unlockDialogSize]);

  const fetchPage = useCallback(
    (offset: number, append: boolean) => {
      setError(null);
      if (append) {
        if (loadingRef.current) return () => undefined;
        if (itemsRef.current.length >= totalRef.current) return () => undefined;
      } else {
        subRef.current?.unsubscribe();
        subRef.current = null;
      }

      loadingRef.current = true;
      const statusFilter = activeFilters.includes('status')
        ? effectiveMulti(statuses, STATUS_IDS)
        : undefined;
      // «Deleted» имеет смысл только при «Показывать удалённые».
      const statusesForApi = statusFilter?.filter((s) => s !== 'deleted' || showDeleted);
      const outcomeFilter = activeFilters.includes('outcome')
        ? effectiveMulti(outcomes, OUTCOME_IDS)
        : undefined;
      const sub = OhsApi.getIncidents({
        module: 'connection',
        connectionId,
        statuses: statusesForApi?.length ? statusesForApi : undefined,
        closeOutcomes: outcomeFilter,
        limit: PAGE_SIZE,
        offset,
        includeDeleted: showDeleted,
      }).subscribe({
        next: (page) => {
          loadingRef.current = false;
          if (subRef.current === sub) subRef.current = null;
          setTotal(page.total);
          setItems((prev) => (append ? [...prev, ...page.items] : page.items));
          setLoaded(true);
          setSelectedCorr((cur) => {
            if (!cur) return null;
            const list = append ? [...itemsRef.current, ...page.items] : page.items;
            return list.some((i) => i.corrUid === cur) ? cur : null;
          });
        },
        error: (err: unknown) => {
          loadingRef.current = false;
          if (subRef.current === sub) subRef.current = null;
          setLoaded(true);
          setError(err instanceof Error ? err.message : 'Не удалось загрузить журнал');
        },
      });
      subRef.current = sub;
      return () => {
        sub.unsubscribe();
        if (subRef.current === sub) {
          subRef.current = null;
          loadingRef.current = false;
        }
      };
    },
    [connectionId, showDeleted, activeFilters, statuses, outcomes],
  );

  const filterSpecs = useMemo<Record<string, FilterSpec>>(
    () => ({
      status: {
        key: 'status',
        name: 'Статус',
        mode: 'multi',
        masterAll: true,
        options: [
          { id: 'active', label: 'Active' },
          { id: 'recovering', label: 'Recovering' },
          { id: 'resolved', label: 'Resolved' },
          {
            id: 'deleted',
            label: 'Deleted',
            disabled: !showDeleted,
            title: showDeleted
              ? undefined
              : 'Включи «Показывать удалённые» внизу',
          },
        ],
        selected: statuses,
        onChange: setStatuses,
      },
      outcome: {
        key: 'outcome',
        name: 'Исход',
        mode: 'multi',
        masterAll: true,
        options: [
          { id: 'recovered', label: 'Решено' },
          { id: 'abandoned_manual', label: 'Закрыто пользователем' },
          { id: 'recovered_manual', label: 'Решено пользователем' },
        ],
        selected: outcomes,
        onChange: setOutcomes,
      },
    }),
    [statuses, outcomes, showDeleted],
  );

  const addFilter = useCallback((key: string) => {
    const k = key as IncidentsModalFilterKey;
    setActiveFilters((prev) => (prev.includes(k) ? prev : [...prev, k]));
    if (k === 'status') setStatuses([...STATUS_IDS]);
    if (k === 'outcome') setOutcomes([...OUTCOME_IDS]);
  }, []);

  const removeFilter = useCallback((key: string) => {
    const k = key as IncidentsModalFilterKey;
    setActiveFilters((prev) => prev.filter((x) => x !== k));
    if (k === 'status') setStatuses([...STATUS_IDS]);
    if (k === 'outcome') setOutcomes([...OUTCOME_IDS]);
  }, []);

  const clearFilters = useCallback(() => {
    setActiveFilters([]);
    setStatuses([...STATUS_IDS]);
    setOutcomes([...OUTCOME_IDS]);
  }, []);

  /** Пишем LS только из открытой модалки; пропускаем кадр restore с чужим in-memory state. */
  useEffect(() => {
    if (!open) return;
    if (skipFilterSaveRef.current) {
      skipFilterSaveRef.current = false;
      return;
    }
    saveIncidentsModalFilters({ activeFilters, statuses, outcomes });
  }, [open, activeFilters, statuses, outcomes]);

  const reload = useCallback(() => fetchPage(0, false), [fetchPage]);

  const loadMore = useCallback(() => {
    if (loadingRef.current) return;
    if (itemsRef.current.length >= totalRef.current) return;
    fetchPage(itemsRef.current.length, true);
  }, [fetchPage]);

  const onTableScroll = useCallback(() => {
    const el = tableWrapRef.current;
    if (!el) return;
    if (el.scrollHeight - (el.scrollTop + el.clientHeight) < NEAR_END_PX) {
      loadMore();
    }
  }, [loadMore]);

  useEffect(() => {
    if (!open) return;
    setEditing(false);
    setShowDeleted(loadIncidentsShowDeleted());
    skipFilterSaveRef.current = true;
    const saved = loadIncidentsModalFilters();
    setActiveFilters(saved.activeFilters);
    setStatuses(saved.statuses);
    setOutcomes(saved.outcomes);
    resetWizard();
    setLoaded(false);
    setTotal(0);
    setSelectedCorr(null);
  }, [open, resetWizard]);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    return reload();
  }, [open, reload]);

  /** Пока открыта — догонять статус active/recovering вместе с NC (не ждать poll ленты). */
  useEffect(() => {
    if (!open) return;
    let cancelPrev: (() => void) | undefined;
    const sub = store.journalInvalidate$.subscribe(() => {
      cancelPrev?.();
      cancelPrev = reload();
    });
    return () => {
      cancelPrev?.();
      sub.unsubscribe();
    };
  }, [open, store, reload]);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      if (wizard === 'close') {
        if (closeStep === 'confirm' && !busy) {
          goCloseReason();
          return;
        }
        if (!busy) resetWizard();
        return;
      }
      if (wizard === 'delete') {
        if (deleteStep === 'confirm' && !busy) {
          goDeleteInfo();
          return;
        }
        if (!busy) resetWizard();
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    open,
    wizard,
    closeStep,
    deleteStep,
    busy,
    onClose,
    resetWizard,
    goCloseReason,
    goDeleteInfo,
  ]);

  if (!open) return null;

  const afterMutate = (wasRecovering: boolean) => {
    setBusy(false);
    resetWizard();
    reload();
    store.refreshLiveness();
    if (wasRecovering) {
      store.refreshConnectionSchedule(connectionId);
    }
  };

  const submitClose = () => {
    if (!selected) return;
    const wasRecovering = selected.status === 'recovering';
    setBusy(true);
    setError(null);
    const note = closeNote.trim();
    OhsApi.resolveIncident(selected.corrUid, {
      resolvedBy: 'superuser',
      closeNote: note || null,
    }).subscribe({
      next: () => afterMutate(wasRecovering),
      error: (err: unknown) => {
        setBusy(false);
        setError(err instanceof Error ? err.message : 'Не удалось закрыть инцидент');
      },
    });
  };

  const submitDelete = () => {
    if (!selected) return;
    const wasRecovering = selected.status === 'recovering';
    setBusy(true);
    setError(null);
    OhsApi.softDeleteIncident(selected.corrUid, { deletedBy: 'superuser' }).subscribe({
      next: () => afterMutate(wasRecovering),
      error: (err: unknown) => {
        setBusy(false);
        setError(err instanceof Error ? err.message : 'Не удалось удалить инцидент');
      },
    });
  };

  const submitRestore = () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    OhsApi.restoreIncident(selected.corrUid).subscribe({
      next: () => afterMutate(false),
      error: (err: unknown) => {
        setBusy(false);
        setError(err instanceof Error ? err.message : 'Не удалось восстановить инцидент');
      },
    });
  };

  const reasonTitle =
    selected?.status === 'recovering'
      ? 'Закрыть инцидент (отключит AUTO)'
      : 'Закрыть инцидент';

  const deleteConsequence =
    selected && isOpenStatus(selected.status)
      ? 'Инцидент будет закрыт и скрыт из журнала, ленты и ЦУ. В дальнейшем можно отменить кнопкой «Восстановить».'
      : 'Инцидент будет скрыт из журнала, ленты и ЦУ. В дальнейшем можно отменить кнопкой «Восстановить».';

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && wizard == null) onClose();
      }}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={
          loaded
            ? `Журнал инцидентов · ${connectionName} (${total})`
            : `Журнал инцидентов · ${connectionName}`
        }
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.head}>
          <strong className={styles.headTitle}>
            Журнал инцидентов · {connectionName}
            {loaded ? ` (${total})` : ''}
          </strong>
          <div className={styles.headActions}>
            <Tip content={editing ? 'Режим редактирования' : 'Режим просмотра'}>
              <button
                type="button"
                className={[styles.iconBtn, editing ? styles.iconBtnPressed : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  setEditing((v) => !v);
                  resetWizard();
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

        <div className={styles.filterRow}>
          <FilterChips
            available={FILTER_AVAILABLE}
            active={activeFilters}
            specs={filterSpecs}
            onAdd={addFilter}
            onRemove={removeFilter}
            onClear={clearFilters}
          />
        </div>

        {editing ? (
          <div className={styles.toolbar}>
            <button
              type="button"
              className={[styles.actionBtn, styles.actionBtnPrimary].join(' ')}
              disabled={!canClose || busy}
              onClick={() => {
                setCloseNote('');
                setCloseStep('reason');
                setStepBackIn(false);
                unlockDialogSize();
                setWizard('close');
              }}
            >
              Закрыть
            </button>
            <button
              type="button"
              className={styles.actionBtn}
              disabled={(!canDelete && !canRestore) || busy}
              onClick={() => {
                if (canRestore) {
                  submitRestore();
                  return;
                }
                setDeleteStep('info');
                setStepBackIn(false);
                unlockDialogSize();
                setWizard('delete');
              }}
            >
              {canRestore ? 'Восстановить' : 'Удалить'}
            </button>
            <span className={styles.toolbarSpacer} />
            {selected && !selectedDeleted && !canClose ? (
              <span className={styles.hint}>Закрыть можно только open-эпизод</span>
            ) : null}
          </div>
        ) : null}

        {error ? <div className={styles.error}>{error}</div> : null}

        <div className={styles.tableWrap} ref={tableWrapRef} onScroll={onTableScroll}>
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
                  const deleted = isDeleted(row);
                  const closeTip = manualCloseTip(row);
                  const delTip = deletedTip(row, formatTs);
                  const outcome = row.closeOutcome ?? '—';
                  const badge = (
                    <span className={statusClass(row, deleted)}>{statusLabel(row)}</span>
                  );
                  return (
                    <tr
                      key={row.corrUid}
                      className={[
                        selectedCorr === row.corrUid ? styles.rowActive : '',
                        deleted ? styles.rowDeleted : '',
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined}
                      onClick={() => setSelectedCorr(row.corrUid)}
                    >
                      <td className={styles.mono}>{formatTs(row.openedAt)}</td>
                      <td>
                        {delTip ? (
                          <Tip content={delTip}>{badge}</Tip>
                        ) : (
                          badge
                        )}
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

        <div className={styles.footer}>
          <span className={styles.footerCount}>
            {!loaded ? 'Загрузка…' : `${items.length} из ${total}`}
          </span>
          <label className={styles.footerCheck}>
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(e) => {
                const next = e.target.checked;
                setShowDeleted(next);
                saveIncidentsShowDeleted(next);
                if (!next) {
                  setStatuses((prev) => prev.filter((s) => s !== 'deleted'));
                }
              }}
            />
            Показывать удалённые
          </label>
        </div>

        {wizard === 'close' && selected ? (
          <div
            className={styles.confirmOverlay}
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget && !busy) resetWizard();
            }}
          >
            <div
              ref={dialogRef}
              className={styles.confirmDialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="inc-close-title"
              onClick={(e) => e.stopPropagation()}
            >
              {closeStep === 'reason' ? (
                <div
                  key="reason"
                  className={[styles.closeStep, stepBackIn ? styles.closeStepBackIn : '']
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
                      disabled={busy}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !busy) goCloseConfirm();
                      }}
                    />
                  </label>
                  <div className={styles.confirmActions}>
                    <button
                      type="button"
                      className={[styles.actionBtn, styles.actionBtnPrimary].join(' ')}
                      disabled={busy}
                      onClick={goCloseConfirm}
                    >
                      Далее
                    </button>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      disabled={busy}
                      onClick={resetWizard}
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
                    <p className={styles.confirmMeta}>Причина: {closeNote.trim()}</p>
                  ) : null}
                  <div className={styles.confirmActions}>
                    <button
                      type="button"
                      className={[styles.actionBtn, styles.actionBtnPrimary].join(' ')}
                      disabled={busy}
                      onClick={submitClose}
                      autoFocus
                    >
                      {busy ? 'Закрываю…' : 'Подтвердить'}
                    </button>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      disabled={busy}
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

        {wizard === 'delete' && selected ? (
          <div
            className={styles.confirmOverlay}
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget && !busy) resetWizard();
            }}
          >
            <div
              ref={dialogRef}
              className={styles.confirmDialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="inc-delete-title"
              onClick={(e) => e.stopPropagation()}
            >
              {deleteStep === 'info' ? (
                <div
                  key="info"
                  className={[styles.closeStep, stepBackIn ? styles.closeStepBackIn : '']
                    .filter(Boolean)
                    .join(' ')}
                >
                  <h4 id="inc-delete-title" className={styles.confirmTitle}>
                    Удалить инцидент
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
                  <p className={styles.confirmWarn}>{deleteConsequence}</p>
                  <div className={styles.confirmActions}>
                    <button
                      type="button"
                      className={[styles.actionBtn, styles.actionBtnPrimary].join(' ')}
                      disabled={busy}
                      onClick={goDeleteConfirm}
                      autoFocus
                    >
                      Далее
                    </button>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      disabled={busy}
                      onClick={resetWizard}
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
                  <h4 id="inc-delete-title" className={styles.confirmTitle}>
                    Подтвердить удаление
                  </h4>
                  <p className={styles.confirmWarn}>
                    Инцидент будет скрыт из журнала, ленты и ЦУ. В дальнейшем можно
                    отменить кнопкой «Восстановить».
                  </p>
                  <div className={styles.confirmActions}>
                    <button
                      type="button"
                      className={[styles.actionBtn, styles.actionBtnPrimary].join(' ')}
                      disabled={busy}
                      onClick={submitDelete}
                      autoFocus
                    >
                      {busy ? 'Удаляю…' : 'Подтвердить'}
                    </button>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      disabled={busy}
                      onClick={goDeleteInfo}
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
