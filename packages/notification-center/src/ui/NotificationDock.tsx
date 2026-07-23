import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { NotificationBus } from '../bus/NotificationBus';
import { filterEvents } from '../filter/filterEvents';
import { formatTsUtc, type FormatTs } from '../format/formatTs';
import type { NotificationEvent, NotificationSeverity } from '../types';
import { DockFilters, EMPTY_DOCK_FILTER, normalizeDockFilter, type DockDateFieldProps, type DockDateRangeProps, type DockFilterKey, type DockFilterState } from './DockFilters';
import {
  EMPTY_DOCK_SETTINGS,
  normalizeDockSettings,
  type NotificationDockSettings,
} from './dockSettings';
import { NotificationRow } from './NotificationRow';
import { Tip } from './Tooltip';
import { useObservable } from './useObservable';
import styles from './NotificationDock.module.css';

export type { NotificationDockSettings } from './dockSettings';
export { EMPTY_DOCK_SETTINGS, normalizeDockSettings } from './dockSettings';

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
  /** @deprecated используйте settings.showFilters */
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
  /** Controlled-настройки дока. */
  settings?: NotificationDockSettings;
  /** Uncontrolled: начальные настройки. */
  initialSettings?: NotificationDockSettings;
  onSettingsChange?: (settings: NotificationDockSettings) => void;
  /** Единый range-календарь для «Период → ввести даты» (как в провайдерах). */
  renderDateRange?: (props: DockDateRangeProps) => ReactNode;
  /** Кастомный пикер одной даты для фильтра «Период → ввести даты». */
  renderDateField?: (props: DockDateFieldProps) => ReactNode;
}

type SettingsToggleKey =
  | 'showFilters'
  | 'trackUnread'
  | 'showStatusLogo'
  | 'showType'
  | 'sendToTray';

const SHOW_TOGGLES: { key: SettingsToggleKey; label: string }[] = [
  { key: 'showFilters', label: 'Панель фильтров' },
  { key: 'trackUnread', label: 'Учёт непрочитанных' },
  { key: 'showStatusLogo', label: 'Показывать логотип' },
  { key: 'showType', label: 'Показывать тип' },
];

const ACTION_TOGGLES: { key: SettingsToggleKey; label: string }[] = [
  { key: 'sendToTray', label: 'Отправлять в трей' },
];

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
  settings: settingsProp,
  initialSettings,
  onSettingsChange,
  renderDateRange,
  renderDateField,
}: NotificationDockProps) {
  const events = useObservable(bus.stream$, bus.events);
  const unreadAlerts = useObservable(bus.unreadAlertCount$, bus.unreadAlertCount);
  const unreadWarnings = useObservable(bus.unreadWarningCount$, bus.unreadWarningCount);

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
  const filter = normalizeDockFilter(filtersControlled ? filtersProp.filter : uncontrolledFilter);
  const activeFilters = filtersControlled ? filtersProp.activeFilters : uncontrolledActive;

  const settingsControlled = settingsProp !== undefined;
  const [uncontrolledSettings, setUncontrolledSettings] = useState<NotificationDockSettings>(() =>
    normalizeDockSettings(initialSettings ?? EMPTY_DOCK_SETTINGS),
  );
  const settings = normalizeDockSettings(
    settingsControlled ? settingsProp : uncontrolledSettings,
  );

  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [filtersMenuOpen, setFiltersMenuOpen] = useState(false);

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

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }
    const onDoc = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [settingsOpen]);

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
      emitFilters(normalizeDockFilter(next), activeFiltersRef.current);
    },
    [emitFilters],
  );

  const handleActiveFiltersChange = useCallback(
    (next: DockFilterKey[]) => {
      emitFilters(filterRef.current, next);
    },
    [emitFilters],
  );

  const emitSettings = useCallback(
    (next: NotificationDockSettings) => {
      const normalized = normalizeDockSettings(next);
      if (!settingsControlled) {
        setUncontrolledSettings(normalized);
      }
      onSettingsChange?.(normalized);
    },
    [settingsControlled, onSettingsChange],
  );

  const toggleSetting = useCallback(
    (key: SettingsToggleKey) => {
      emitSettings({ ...settings, [key]: !settings[key] });
    },
    [emitSettings, settings],
  );

  const showFiltersPanel = !hideFilters && settings.showFilters;
  const showUnreadUi = settings.trackUnread;

  /** Быстрый фильтр с бейджа: создать плашку «Тип сообщения» и toggle галок. */
  const quickFilterSeverities = useCallback(
    (targets: readonly NotificationSeverity[]) => {
      const cur = filterRef.current;
      const active = activeFiltersRef.current;
      const allOn = targets.every((s) => cur.severities.includes(s));
      const nextSeverities = allOn
        ? cur.severities.filter((s) => !targets.includes(s))
        : [...new Set([...cur.severities, ...targets])];
      const nextActive: DockFilterKey[] = active.includes('severity')
        ? active
        : [...active, 'severity'];
      emitFilters({ ...cur, severities: nextSeverities }, nextActive);
      if (!expanded) {
        setExpanded(true);
        setBodyMounted(true);
        setHeight(lastHeight);
      }
    },
    [emitFilters, expanded, lastHeight, setExpanded],
  );

  /** Клик по Id инцидента: показать всю его ленту — сбрасываем прочие фильтры, ищем по correlationId. */
  const filterByIncident = useCallback(
    (correlationId: string) => {
      emitFilters({ ...EMPTY_DOCK_FILTER, query: correlationId }, []);
      if (!expanded) {
        setExpanded(true);
        setBodyMounted(true);
        setHeight(lastHeight);
      }
    },
    [emitFilters, expanded, lastHeight, setExpanded],
  );

  const visible = useMemo(
    () =>
      filterEvents(events, {
        severities: filter.severities,
        interactions: filter.interactions,
        localizations: filter.localizations,
        statuses: filter.statuses,
        query: filter.query,
        range: activeFilters.includes('range') ? filter.range : undefined,
      }),
    [events, filter, activeFilters],
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
      className={[
        styles.dock,
        resizing ? styles.dockResizing : '',
        filtersMenuOpen ? styles.dockMenuOpen : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
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
          aria-label="Изменить высоту"
        />
      )}

      <header className={styles.header}>
        <div className={styles.titleCluster}>
          <button type="button" className={styles.titleBtn} onClick={toggleExpanded} aria-expanded={expanded}>
            <span className={[styles.chevron, expanded ? styles.chevronOpen : ''].filter(Boolean).join(' ')}>
              ▴
            </span>
            <span className={styles.title}>{title}</span>
          </button>
          {showUnreadUi && (unreadAlerts > 0 || unreadWarnings > 0) && (
            <span className={styles.badges}>
              {unreadAlerts > 0 && (
                <Tip content="Фильтр: error / critical">
                  <button
                    type="button"
                    className={[styles.badge, styles.badgeAlert].join(' ')}
                    aria-label="Фильтр по error и critical"
                    aria-pressed={
                      filter.severities.includes('error') && filter.severities.includes('critical')
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      quickFilterSeverities(['error', 'critical']);
                    }}
                  >
                    {unreadAlerts > 99 ? '99+' : unreadAlerts}
                  </button>
                </Tip>
              )}
              {unreadWarnings > 0 && (
                <Tip content="Фильтр: warning">
                  <button
                    type="button"
                    className={[styles.badge, styles.badgeWarning].join(' ')}
                    aria-label="Фильтр по warning"
                    aria-pressed={filter.severities.includes('warning')}
                    onClick={(e) => {
                      e.stopPropagation();
                      quickFilterSeverities(['warning']);
                    }}
                  >
                    {unreadWarnings > 99 ? '99+' : unreadWarnings}
                  </button>
                </Tip>
              )}
            </span>
          )}
        </div>
        <div className={styles.headerActions}>
          {expanded && (
            <>
              {tailPaused && (
                <button type="button" className={styles.actionBtn} onClick={() => setTailPaused(false)}>
                  Следить
                </button>
              )}
              {showUnreadUi && (
                <button type="button" className={styles.actionBtn} onClick={() => bus.markAllRead()}>
                  Прочитать
                </button>
              )}
              <button type="button" className={styles.actionBtn} onClick={() => bus.clear()}>
                Очистить
              </button>
            </>
          )}
          <div className={styles.settingsWrap} ref={settingsRef}>
            <Tip content="Настройки">
              <button
                type="button"
                className={[styles.settingsBtn, settingsOpen ? styles.settingsBtnActive : '']
                  .filter(Boolean)
                  .join(' ')}
                aria-label="Настройки"
                aria-expanded={settingsOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  setSettingsOpen((o) => !o);
                }}
              >
                <svg
                  className={styles.settingsIcon}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            </Tip>
            {settingsOpen && (
              <div className={styles.settingsPopover} role="menu" aria-label="Настройки центра уведомлений">
                <div className={styles.settingsSection}>
                  <span className={styles.settingsSectionTitle}>Показывать</span>
                  {SHOW_TOGGLES.map((t) => (
                    <label key={t.key} className={styles.settingsCheck}>
                      <input
                        type="checkbox"
                        checked={settings[t.key]}
                        onChange={() => toggleSetting(t.key)}
                      />
                      {t.label}
                    </label>
                  ))}
                </div>
                <div className={styles.settingsSection}>
                  <span className={styles.settingsSectionTitle}>Действия</span>
                  {ACTION_TOGGLES.map((t) => (
                    <label key={t.key} className={styles.settingsCheck}>
                      <input
                        type="checkbox"
                        checked={settings[t.key]}
                        onChange={() => toggleSetting(t.key)}
                      />
                      {t.label}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {bodyMounted && (
        <div className={[styles.body, bodyVisible ? styles.bodyOpen : ''].filter(Boolean).join(' ')}>
          {showFiltersPanel && (
            <DockFilters
              value={filter}
              onChange={handleFilterChange}
              activeFilters={activeFilters}
              onActiveFiltersChange={handleActiveFiltersChange}
              onCommit={(snapshot) => emitFilters(snapshot.filter, snapshot.activeFilters)}
              onMenuOpenChange={setFiltersMenuOpen}
              renderDateRange={renderDateRange}
              renderDateField={renderDateField}
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
                  showStatusLogo={settings.showStatusLogo}
                  showType={settings.showType}
                  unread={
                    showUnreadUi &&
                    (evt.severity === 'warning' ||
                      evt.severity === 'error' ||
                      evt.severity === 'critical') &&
                    !bus.isRead(evt.id)
                  }
                  onOpen={showUnreadUi ? onOpenRow : undefined}
                  onFilterIncident={filterByIncident}
                />
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}
