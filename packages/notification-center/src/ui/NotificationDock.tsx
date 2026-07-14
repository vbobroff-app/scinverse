import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { NotificationBus } from '../bus/NotificationBus';
import { filterEvents } from '../filter/filterEvents';
import { formatTsUtc, type FormatTs } from '../format/formatTs';
import type { NotificationEvent } from '../types';
import { DockFilters, type DockFilterState } from './DockFilters';
import { NotificationRow } from './NotificationRow';
import { useObservable } from './useObservable';
import styles from './NotificationDock.module.css';

const MIN_HEIGHT = 40;
const DEFAULT_EXPANDED_HEIGHT = Math.round(
  typeof window !== 'undefined' ? window.innerHeight / 2 : 320,
);

export interface NotificationDockProps {
  /** Шина событий (хост создаёт и кормит из любого источника). */
  bus: NotificationBus;
  /**
   * Форматтер времени из системной настройки хоста (UTC / МСК / UTC+N).
   * По умолчанию — UTC.
   */
  formatTs?: FormatTs;
  title?: string;
  defaultExpanded?: boolean;
  /** Начальная высота раскрытого дока (px). */
  defaultHeight?: number;
  className?: string;
  /** Скрыть панель фильтров. */
  hideFilters?: boolean;
}

export function NotificationDock({
  bus,
  formatTs = formatTsUtc,
  title = 'Центр уведомлений',
  defaultExpanded = false,
  defaultHeight,
  className,
  hideFilters = false,
}: NotificationDockProps) {
  const events = useObservable(bus.stream$, bus.events);
  const unread = useObservable(bus.unreadAlertCount$, bus.unreadAlertCount);

  const [expanded, setExpanded] = useState(defaultExpanded);
  const [height, setHeight] = useState(defaultExpanded ? (defaultHeight ?? DEFAULT_EXPANDED_HEIGHT) : MIN_HEIGHT);
  const [lastHeight, setLastHeight] = useState(defaultHeight ?? DEFAULT_EXPANDED_HEIGHT);
  const [filter, setFilter] = useState<DockFilterState>({
    severities: [],
    sourceTypes: [],
    query: '',
  });
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [tailPaused, setTailPaused] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const modules = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) {
      set.add(e.module);
    }
    return [...set].sort();
  }, [events]);

  const visible = useMemo(
    () =>
      filterEvents(events, {
        severities: filter.severities,
        sourceTypes: filter.sourceTypes,
        modules: selectedModules,
        query: filter.query,
      }),
    [events, filter, selectedModules],
  );

  // Live-tail: новые события → скролл вверх списка (новые сверху), пауза при ручном уходе.
  useEffect(() => {
    if (!expanded || tailPaused || !listRef.current) {
      return;
    }
    listRef.current.scrollTop = 0;
  }, [visible, expanded, tailPaused]);

  const onListScroll = () => {
    const el = listRef.current;
    if (!el) {
      return;
    }
    setTailPaused(el.scrollTop > 8);
  };

  const toggleExpanded = () => {
    setExpanded((prev) => {
      if (prev) {
        setLastHeight(Math.max(height, MIN_HEIGHT + 80));
        setHeight(MIN_HEIGHT);
        return false;
      }
      setHeight(lastHeight);
      return true;
    });
  };

  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!expanded) {
      return;
    }
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startHeight: height };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    const max = Math.round(window.innerHeight * 0.7);
    const next = Math.min(max, Math.max(120, drag.startHeight + (drag.startY - e.clientY)));
    setHeight(next);
  };

  const onResizePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) {
      return;
    }
    dragRef.current = null;
    setLastHeight(height);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onOpenRow = useCallback(
    (event: NotificationEvent) => {
      bus.markRead(event.id);
    },
    [bus],
  );

  return (
    <section
      className={[styles.dock, className].filter(Boolean).join(' ')}
      style={{ height }}
      aria-label={title}
    >
      {expanded && (
        <div
          className={styles.resizeHandle}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          role="separator"
          aria-orientation="horizontal"
          title="Потяните, чтобы изменить высоту"
        />
      )}

      <header className={styles.header}>
        <button type="button" className={styles.titleBtn} onClick={toggleExpanded} aria-expanded={expanded}>
          <span className={[styles.chevron, expanded ? styles.chevronOpen : ''].filter(Boolean).join(' ')}>
            ▴
          </span>
          <span className={styles.title}>{title}</span>
          {unread > 0 && (
            <span className={styles.badge} title="Непрочитанные ошибки / critical">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
        <div className={styles.headerActions}>
          {expanded && (
            <>
              {tailPaused && (
                <button type="button" className={styles.actionBtn} onClick={() => setTailPaused(false)}>
                  Следить
                </button>
              )}
              <button type="button" className={styles.actionBtn} onClick={() => bus.markAllRead()}>
                Прочитать
              </button>
              <button type="button" className={styles.actionBtn} onClick={() => bus.clear()}>
                Очистить
              </button>
            </>
          )}
        </div>
      </header>

      {expanded && (
        <>
          {!hideFilters && (
            <DockFilters
              value={filter}
              modules={modules}
              selectedModules={selectedModules}
              onChange={setFilter}
              onModulesChange={setSelectedModules}
            />
          )}
          <div className={styles.list} ref={listRef} onScroll={onListScroll}>
            {visible.length === 0 ? (
              <div className={styles.empty}>Нет уведомлений</div>
            ) : (
              visible.map((evt) => (
                <NotificationRow
                  key={evt.id}
                  event={evt}
                  formatTs={formatTs}
                  unread={
                    (evt.severity === 'error' || evt.severity === 'critical') && !bus.isRead(evt.id)
                  }
                  onOpen={onOpenRow}
                />
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}
