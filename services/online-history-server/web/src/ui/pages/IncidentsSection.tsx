import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createOffsetFormatTs, formatTsUtc } from '@scinverse/notification-center';
import { OhsApi } from '../../core/api';
import {
  loadIncidentsShowDeleted,
  saveIncidentsShowDeleted,
} from '../../core/incidentsJournalStorage';
import type { IncidentDto } from '../../core/types';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { formatDurationMs } from './formatDurationMs';
import styles from './IncidentsSection.module.css';

type StatusFilter = '' | 'active' | 'recovering' | 'resolved';
type TypeFilter = '' | 'break' | 'crash';

const PAGE_SIZE = 100;
/** Порог до низа скролла (px), при котором догружаем следующую страницу. */
const NEAR_END_PX = 200;

/**
 * Журнал инцидентов (phase 11.13d): список эпизодов из OHS `GET /api/incidents`.
 * Не путать с доком NC (атомы notify) — здесь таблица `incident`.
 */
export function IncidentsSection() {
  const store = useOhsStore();
  const tz = useBehavior(store.displayTz$);
  const formatTs = useMemo(
    () => (tz.offsetMin === 0 ? formatTsUtc : createOffsetFormatTs(tz.offsetMin)),
    [tz.offsetMin],
  );

  const [items, setItems] = useState<IncidentDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('');
  const [type, setType] = useState<TypeFilter>('');
  const [connectionId, setConnectionId] = useState('');
  const [showDeleted, setShowDeleted] = useState(() => loadIncidentsShowDeleted());
  const [selected, setSelected] = useState<IncidentDto | null>(null);
  const [resolving, setResolving] = useState(false);

  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  const subRef = useRef<{ unsubscribe: () => void } | null>(null);
  const itemsRef = useRef(items);
  const totalRef = useRef(total);
  itemsRef.current = items;
  totalRef.current = total;

  const fetchPage = useCallback(
    (offset: number, append: boolean) => {
      setError(null);
      const conn = connectionId.trim() === '' ? undefined : Number(connectionId);
      if (connectionId.trim() !== '' && !Number.isFinite(conn)) {
        setError('connectionId — число');
        setLoaded(true);
        return () => undefined;
      }

      // Append не стартует, пока идёт другой запрос; replace отменяет текущий.
      if (append) {
        if (loadingRef.current) return () => undefined;
        if (itemsRef.current.length >= totalRef.current) return () => undefined;
      } else {
        subRef.current?.unsubscribe();
        subRef.current = null;
      }

      loadingRef.current = true;
      const sub = OhsApi.getIncidents({
        module: 'connection',
        status: status || undefined,
        type: type || undefined,
        connectionId: conn,
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
          setSelected((cur) => {
            if (!cur) return null;
            const list = append ? [...itemsRef.current, ...page.items] : page.items;
            return list.find((i) => i.corrUid === cur.corrUid) ?? null;
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
    [status, type, connectionId, showDeleted],
  );

  const reload = useCallback(() => fetchPage(0, false), [fetchPage]);

  const loadMore = useCallback(() => {
    if (loadingRef.current) return;
    if (itemsRef.current.length >= totalRef.current) return;
    fetchPage(itemsRef.current.length, true);
  }, [fetchPage]);

  useEffect(() => reload(), [reload]);

  /** Lifecycle NC → store обновил journal; страница догоняет список без ручного Refresh. */
  useEffect(() => {
    let cancelPrev: (() => void) | undefined;
    const sub = store.journalInvalidate$.subscribe(() => {
      cancelPrev?.();
      cancelPrev = reload();
    });
    return () => {
      cancelPrev?.();
      sub.unsubscribe();
    };
  }, [store, reload]);

  const onTableScroll = useCallback(() => {
    const el = tableWrapRef.current;
    if (!el) return;
    if (el.scrollHeight - (el.scrollTop + el.clientHeight) < NEAR_END_PX) {
      loadMore();
    }
  }, [loadMore]);

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Журнал инцидентов</h1>
            <p className={styles.sub}>Эпизоды связи (break/crash) из OHS · не лента NC</p>
          </div>
          <button type="button" className={styles.refresh} onClick={() => reload()}>
            Обновить
          </button>
        </header>

        <div className={styles.filters}>
          <label className={styles.filter}>
            Статус
            <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
              <option value="">Все</option>
              <option value="active">active</option>
              <option value="recovering">recovering</option>
              <option value="resolved">resolved</option>
            </select>
          </label>
          <label className={styles.filter}>
            Тип
            <select value={type} onChange={(e) => setType(e.target.value as TypeFilter)}>
              <option value="">Все</option>
              <option value="break">break</option>
              <option value="crash">crash</option>
            </select>
          </label>
          <label className={styles.filter}>
            Connection
            <input
              type="text"
              inputMode="numeric"
              placeholder="id"
              value={connectionId}
              onChange={(e) => setConnectionId(e.target.value)}
            />
          </label>
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}

        <div className={styles.tableWrap} ref={tableWrapRef} onScroll={onTableScroll}>
          {!loaded ? (
            <div className={styles.empty}>Загрузка…</div>
          ) : items.length === 0 ? (
            <div className={styles.empty}>Нет инцидентов по фильтру</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Открыт</th>
                  <th>Статус</th>
                  <th>Тип</th>
                  <th>Conn</th>
                  <th>Заголовок</th>
                  <th>Длит.</th>
                  <th>Исход</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const deleted = row.deletedAt != null && row.deletedAt !== '';
                  return (
                    <tr
                      key={row.corrUid}
                      className={[
                        selected?.corrUid === row.corrUid ? styles.rowActive : '',
                        deleted ? styles.rowDeleted : '',
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined}
                      onClick={() => setSelected(row)}
                    >
                      <td className={styles.mono}>{formatTs(row.openedAt)}</td>
                      <td>
                        <span className={statusClass(row.status, deleted)}>
                          {deleted ? 'deleted' : row.status}
                        </span>
                      </td>
                      <td>{row.type}</td>
                      <td>{row.connectionId ?? '—'}</td>
                      <td className={styles.titleCell}>{row.title || row.subject}</td>
                      <td className={styles.mono}>{formatDurationMs(row.durationMs)}</td>
                      <td>{row.closeOutcome ?? '—'}</td>
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
              }}
            />
            Показывать удалённые
          </label>
        </div>
      </div>

      <aside className={styles.detail}>
        {selected ? (
          <IncidentDetail
            incident={selected}
            formatTs={formatTs}
            busy={resolving}
            onResolve={() => {
              setResolving(true);
              setError(null);
              OhsApi.resolveIncident(selected.corrUid, { resolvedBy: 'superuser' }).subscribe({
                next: (updated) => {
                  setResolving(false);
                  setSelected(updated);
                  reload();
                },
                error: (err: unknown) => {
                  setResolving(false);
                  setError(err instanceof Error ? err.message : 'Не удалось закрыть инцидент');
                },
              });
            }}
          />
        ) : (
          <div className={styles.detailEmpty}>Выбери строку — детали corr / owner / escalate</div>
        )}
      </aside>
    </div>
  );
}

function IncidentDetail({
  incident,
  formatTs,
  busy,
  onResolve,
}: {
  incident: IncidentDto;
  formatTs: (iso: string) => string;
  busy: boolean;
  onResolve: () => void;
}) {
  const open = incident.status === 'active' || incident.status === 'recovering';
  return (
    <div className={styles.detailBody}>
      <h2 className={styles.detailTitle}>{incident.title || incident.type}</h2>
      <dl className={styles.dl}>
        <dt>corr</dt>
        <dd className={styles.mono}>{incident.corrUid}</dd>
        <dt>subject</dt>
        <dd className={styles.mono}>{incident.subject}</dd>
        <dt>module / type</dt>
        <dd>
          {incident.module} · {incident.type}
          {incident.subtype ? ` · ${incident.subtype}` : ''}
        </dd>
        <dt>status</dt>
        <dd>
          <span
            className={statusClass(
              incident.status,
              incident.deletedAt != null && incident.deletedAt !== '',
            )}
          >
            {incident.deletedAt ? 'deleted' : incident.status}
          </span>
          {incident.closeOutcome ? ` → ${incident.closeOutcome}` : ''}
        </dd>
        {incident.deletedAt ? (
          <>
            <dt>deleted</dt>
            <dd className={styles.mono}>
              {formatTs(incident.deletedAt)}
              {incident.deletedBy ? ` · ${incident.deletedBy}` : ''}
            </dd>
          </>
        ) : null}
        <dt>severity</dt>
        <dd>{incident.severity}</dd>
        <dt>owner</dt>
        <dd>{incident.owner ?? '—'}</dd>
        <dt>opened</dt>
        <dd className={styles.mono}>{formatTs(incident.openedAt)}</dd>
        <dt>escalated</dt>
        <dd className={styles.mono}>
          {incident.escalatedAt ? formatTs(incident.escalatedAt) : '—'}
        </dd>
        <dt>closed</dt>
        <dd className={styles.mono}>
          {incident.closedAt ? formatTs(incident.closedAt) : '—'}
        </dd>
        <dt>duration</dt>
        <dd className={styles.mono}>{formatDurationMs(incident.durationMs)}</dd>
        <dt>connection / source</dt>
        <dd>
          {incident.connectionId ?? '—'} / {incident.sourceId ?? '—'}
        </dd>
        <dt>resolved by</dt>
        <dd>{incident.resolvedBy ?? '—'}</dd>
      </dl>
      {open && !incident.deletedAt ? (
        <button
          type="button"
          className={styles.resolveBtn}
          disabled={busy}
          onClick={onResolve}
        >
          {busy ? 'Закрываю…' : 'Закрыть вручную'}
        </button>
      ) : null}
    </div>
  );
}

function statusClass(status: string, deleted = false): string {
  if (deleted) return styles.badgeDeleted;
  if (status === 'active') return styles.badgeActive;
  if (status === 'recovering') return styles.badgeRecovering;
  if (status === 'resolved') return styles.badgeResolved;
  return styles.badge;
}
