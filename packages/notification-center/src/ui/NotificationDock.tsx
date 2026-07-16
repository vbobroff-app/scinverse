import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { NotificationBus } from '../bus/NotificationBus';
import { filterEvents } from '../filter/filterEvents';
import { formatTsUtc, type FormatTs } from '../format/formatTs';
import type { NotificationEvent } from '../types';
import { DockFilters, EMPTY_DOCK_FILTER, type DockFilterKey, type DockFilterState } from './DockFilters';
import { NotificationRow } from './NotificationRow';
import { useObservable } from './useObservable';
import styles from './NotificationDock.module.css';

const MIN_HEIGHT = 40;
const DEFAULT_EXPANDED_HEIGHT = Math.round(
  typeof window !== 'undefined' ? window.innerHeight * 0.3 : 240,
);

/** Снимок фильтров дока для persist на стороне хоста (localStorage и т.п.). */
export interface NotificationDockFiltersSnapshot {
  filter: DockFilterState;
  activeFilters: DockFilterKey[];
}

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
  /**
   * Controlled: раскрыт ли список (Expanded) vs только заголовок (Collapsed).
   * Visibility (показывать ли док) — ответственность хоста (колокольчик), не этого пропа.
   */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Начальная высота Expanded (px). По умолчанию ~30% окна. */
  defaultHeight?: number;
  className?: string;
  /** Скрыть панель фильтров. */
  hideFilters?: boolean;
  /**
   * Controlled-фильтры (хост = источник правды, как FilterChips + OhsStore).
   * Если задано — локальный state фильтров не используется.
   */
  filters?: NotificationDockFiltersSnapshot;
  /** Uncontrolled: начальные значения (если `filters` не передан). */
  initialFilters?: NotificationDockFiltersSnapshot;
  /** Колбэк при изменении фильтров/плашек — хост пишет в store/localStorage. */
  onFiltersChange?: (snapshot: NotificationDockFiltersSnapshot) => void;
}

export function NotificationDock({
  bus,
  formatTs = formatTsUtc,
  title = 'Центр уведомлений',
  defaultExpanded = false,
  expanded: expandedProp,
  onExpandedChange,
  defaultHeight,
  className,
  hideFilters = false,
  filters: filtersProp,
  initialFilters,
  onFiltersChange,
}: NotificationDockProps) {
  const events = useObservable(bus.stream$, bus.events);
  const unread = useObservable(bus.unreadAlertCount$, bus.unreadAlertCount);

  const controlledExpanded = expandedProp !== undefined;
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(defaultExpanded);
  const expanded = controlledExpanded ? expandedProp : uncontrolledExpanded;

  const filtersControlled = filtersProp !== undefined;
  const [uncontrolledFilter, setUncontrolledFilter] = useState<DockFilterState>(
    () => initialFilters?.filter ?? EMPTY_DOCK_FILTER,
  );
  const [uncontrolledActive, setUncontrolledActive] = useState<DockFilterKey[]>(
    () => initialFilters?.activeFilters ?? [],
  );
  const filter = filtersControlled ? filtersProp.filter : uncontrolledFilter;
  const activeFilters = filtersControlled ? filtersProp.activeFilters : uncontrolledActive;

  const [height, setHeight] = useState(
    (controlledExpanded ? expandedProp : defaultExpanded)
      ? (defaultHeight ?? DEFAULT_EXPANDED_HEIGHT)
      : MIN_HEIGHT,
  );
  const [lastHeight, setLastHeight] = useState(defaultHeight ?? DEFAULT_EXPANDED_HEIGHT);
  const [tailPaused, setTailPaused] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const [bodyMounted, setBodyMounted] = useState(expanded);
  const [bodyVisible, setBodyVisible] = useState(expanded);

  // Тело дока: mount сразу при expand, opacity — на следующем кадре; unmount после collapse.
  useEffect(() => {
    if (expanded) {
      setBodyMounted(true);
      const id = requestAnimationFrame(() => setBodyVisible(true));
      return () => cancelAnimationFrame(id);
    }
    setBodyVisible(false);
    const timer = window.setTimeout(() => setBodyMounted(false), 200);
    return () => window.clearTimeout(timer);
  }, [expanded]);

  const setExpanded = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const value = typeof next === 'function' ? next(expanded) : next;
      if (!controlledExpanded) {
        setUncontrolledExpanded(value);
      }
      onExpandedChange?.(value);
    },
    [controlledExpanded, expanded, onExpandedChange],
  );

  // Refs: атомарный снимок при двойном вызове onRemove (active + value) в одном тике.
  const filterRef = useRef(filter);
  const activeFiltersRef = useRef(activeFilters);
  filterRef.current = filter;
  activeFiltersRef.current = activeFilters;

  const emitFilters = useCallback(
    (nextFilter: DockFilterState, nextActive: DockFilterKey[]) => {
      filterRef.current = nextFilter;
      activeFiltersRef.current = nextActive;
      if (!filtersControlled) {
        setUncontrolledFilter(nextFilter);
        setUncontrolledActive(nextActive);
      }
      onFiltersChange?.({ filter: nextFilter, activeFilters: nextActive });
    },
    [filtersControlled, onFiltersChange],
  );

  const handleFilterChange = useCallback(
    (next: DockFilterState) => {
      emitFilters(next, activeFiltersRef.current);
    },
    [emitFilters],
  );

  const handleActiveFiltersChange = useCallback(
    (next: DockFilterKey[]) => {
      emitFilters(filterRef.current, next);
    },
    [emitFilters],
  );

  const visible = useMemo(
    () =>
      filterEvents(events, {
        severities: filter.severities,
        interactions: filter.interactions,
        localizations: filter.localizations,
        query: filter.query,
      }),
    [events, filter],
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
      setBodyMounted(true);
      setHeight(lastHeight);
      return true;
    });
  };

  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!expanded) {
      return;
    }
    e.preventDefault();
    setResizing(true);
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
    setResizing(false);
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
      className={[styles.dock, resizing ? styles.dockResizing : '', className].filter(Boolean).join(' ')}
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

      {bodyMounted && (
        <div className={[styles.body, bodyVisible ? styles.bodyOpen : ''].filter(Boolean).join(' ')}>
          {!hideFilters && (
            <DockFilters
              value={filter}
              onChange={handleFilterChange}
              activeFilters={activeFilters}
              onActiveFiltersChange={handleActiveFiltersChange}
              total={visible.length}
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
        </div>
      )}
    </section>
  );
}
