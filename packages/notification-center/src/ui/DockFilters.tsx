import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  NotificationInteraction,
  NotificationLocalization,
  NotificationSeverity,
  NotificationStatus,
} from '../types';
import {
  DOCK_RANGE_PRESETS,
  EMPTY_DOCK_RANGE,
  rangeSummary,
  type DockRangeFilter,
  type DockRangePreset,
} from '../filter/dateRange';
import {
  normalizeDockFilter,
  type DockFilterKey,
  type DockFilterState,
  type DockFiltersSnapshot,
} from './dockFilterState';
import { SeverityIcon } from './SeverityIcon';
import { Tip } from './Tooltip';
import styles from './DockFilters.module.css';

export type { DockFilterKey, DockFilterState, DockFiltersSnapshot } from './dockFilterState';
export { EMPTY_DOCK_FILTER, normalizeDockFilter } from './dockFilterState';

/** Поле даты для «ввести даты» — хост может подставить свой календарь (как в коннекторах). */
export interface DockDateFieldProps {
  value?: string;
  onChange: (ymd: string | undefined) => void;
  placeholder?: string;
}

/**
 * Единый range-пикер для «ввести даты» — хост подставляет тот же календарь, что в провайдерах
 * (`DateRangePicker`). Значения — локальные `YYYY-MM-DD`. Предпочтительнее `renderDateField`.
 */
export interface DockDateRangeProps {
  from?: string;
  to?: string;
  onApply: (from: string, to: string) => void;
  /** Пользователь нажал «Сбросить» в календаре (напр. закрыть его). */
  onReset?: () => void;
}

interface Props {
  value: DockFilterState;
  onChange: (next: DockFilterState) => void;
  activeFilters: DockFilterKey[];
  onActiveFiltersChange: (keys: DockFilterKey[]) => void;
  /** Атомарный снимок (add/remove/period) — предпочтительно для persist. */
  onCommit?: (snapshot: DockFiltersSnapshot) => void;
  /** Сообщает хосту, что открыт поповер (чтобы снять overflow:hidden у дока). */
  onMenuOpenChange?: (open: boolean) => void;
  /** Единый range-календарь (как в провайдерах). Предпочтительнее `renderDateField`. */
  renderDateRange?: (props: DockDateRangeProps) => ReactNode;
  /** Кастомный пикер одной даты (иначе native `<input type="date">`). */
  renderDateField?: (props: DockDateFieldProps) => ReactNode;
  total?: number;
}

type OpenKey = 'add' | DockFilterKey | null;

interface FilterOption {
  id: string;
  label: string;
  icon?: ReactNode;
}

interface ChipSpec {
  key: DockFilterKey;
  name: string;
  options: FilterOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

const AVAILABLE: { key: DockFilterKey; name: string }[] = [
  { key: 'severity', name: 'Тип сообщения' },
  { key: 'interaction', name: 'Взаимодействие' },
  { key: 'localization', name: 'Локализация' },
  { key: 'status', name: 'Статус' },
  { key: 'range', name: 'Период' },
];

const SEVERITY_OPTIONS: FilterOption[] = [
  { id: 'ok', label: 'ок', icon: <SeverityIcon severity="ok" /> },
  { id: 'info', label: 'info', icon: <SeverityIcon severity="info" /> },
  { id: 'warning', label: 'warning', icon: <SeverityIcon severity="warning" /> },
  { id: 'error', label: 'error', icon: <SeverityIcon severity="error" /> },
  { id: 'critical', label: 'critical', icon: <SeverityIcon severity="critical" /> },
];

const INTERACTION_OPTIONS: FilterOption[] = [
  { id: 'user', label: 'Пользовательские' },
  { id: 'system', label: 'Системный' },
];

const LOCALIZATION_OPTIONS: FilterOption[] = [
  { id: 'internal', label: 'Внутренние' },
  { id: 'external', label: 'Внешние' },
];

const STATUS_OPTIONS: FilterOption[] = [
  { id: 'active', label: 'Активные' },
  { id: 'underway', label: 'Восстановление' },
  { id: 'resolved', label: 'Решённые' },
];

function isFilterAtDefault(key: DockFilterKey, value: DockFilterState): boolean {
  if (key === 'severity') {
    return value.severities.length === 0;
  }
  if (key === 'interaction') {
    return value.interactions.length === 0;
  }
  if (key === 'localization') {
    return value.localizations.length === 0;
  }
  if (key === 'status') {
    return value.statuses.length === 0;
  }
  return value.range.preset === 'all' || !value.range.preset;
}

function resetFilterValue(key: DockFilterKey, value: DockFilterState): DockFilterState {
  if (key === 'severity') {
    return { ...value, severities: [] };
  }
  if (key === 'interaction') {
    return { ...value, interactions: [] };
  }
  if (key === 'localization') {
    return { ...value, localizations: [] };
  }
  if (key === 'status') {
    return { ...value, statuses: [] };
  }
  return { ...value, range: { ...EMPTY_DOCK_RANGE } };
}

/**
 * Плашки фильтров дока в стиле provider workspace:
 * слева [+] · плашки · [×], справа «Найдено» + поиск с иконкой.
 */
export function DockFilters({
  value: valueProp,
  onChange,
  activeFilters,
  onActiveFiltersChange,
  onCommit,
  onMenuOpenChange,
  renderDateRange,
  renderDateField,
  total,
}: Props) {
  const value = normalizeDockFilter(valueProp);
  const [open, setOpen] = useState<OpenKey>(null);
  // Календарь «ввести даты» показываем только по явному клику, не автоматически при custom.
  const [calendarOpen, setCalendarOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const commit = (nextFilter: DockFilterState, nextActive: DockFilterKey[]) => {
    const filter = normalizeDockFilter(nextFilter);
    if (onCommit) {
      onCommit({ filter, activeFilters: nextActive });
      return;
    }
    onChange(filter);
    onActiveFiltersChange(nextActive);
  };

  useEffect(() => {
    onMenuOpenChange?.(open !== null);
    if (open !== 'range') {
      setCalendarOpen(false);
    }
  }, [open, onMenuOpenChange]);

  useEffect(() => {
    if (open === null) {
      return;
    }
    let removeOutside: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      const onDoc = (e: MouseEvent) => {
        const target = e.target as Node;
        if (popoverRef.current?.contains(target)) {
          return;
        }
        // Триггер текущего popover сам переключает open — не закрываем заранее,
        // иначе click снова откроет меню.
        const trigger = rootRef.current?.querySelector(
          `[data-filter-trigger="${open}"]`,
        );
        if (trigger?.contains(target)) {
          return;
        }
        setOpen(null);
      };
      document.addEventListener('mousedown', onDoc);
      removeOutside = () => document.removeEventListener('mousedown', onDoc);
    }, 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(null);
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      window.clearTimeout(timer);
      removeOutside?.();
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const specs = useMemo<Record<Exclude<DockFilterKey, 'range'>, ChipSpec>>(
    () => ({
      severity: {
        key: 'severity',
        name: 'Тип сообщения',
        options: SEVERITY_OPTIONS,
        selected: value.severities,
        onChange: (selected) => onChange({ ...value, severities: selected as NotificationSeverity[] }),
      },
      interaction: {
        key: 'interaction',
        name: 'Взаимодействие',
        options: INTERACTION_OPTIONS,
        selected: value.interactions,
        onChange: (selected) =>
          onChange({ ...value, interactions: selected as NotificationInteraction[] }),
      },
      localization: {
        key: 'localization',
        name: 'Локализация',
        options: LOCALIZATION_OPTIONS,
        selected: value.localizations,
        onChange: (selected) =>
          onChange({ ...value, localizations: selected as NotificationLocalization[] }),
      },
      status: {
        key: 'status',
        name: 'Статус',
        options: STATUS_OPTIONS,
        selected: value.statuses,
        onChange: (selected) => onChange({ ...value, statuses: selected as NotificationStatus[] }),
      },
    }),
    [value, onChange],
  );

  const toggleOpen = (key: OpenKey) => setOpen((cur) => (cur === key ? null : key));

  const onAdd = (key: DockFilterKey) => {
    if (activeFilters.includes(key)) {
      return;
    }
    let nextValue = value;
    if (key === 'range' && (value.range.preset === 'all' || !value.range.preset)) {
      nextValue = { ...value, range: { preset: 'today' } };
    }
    commit(nextValue, [...activeFilters, key]);
  };

  /** Полное удаление (меню «+»). */
  const onRemove = (key: DockFilterKey) => {
    commit(resetFilterValue(key, value), activeFilters.filter((k) => k !== key));
    setOpen(null);
  };

  /**
   * Крестик на чипе: сначала сброс к дефолту (галочки off / период «за всё время»),
   * повторный клик при дефолте — убирает фильтр.
   */
  const onChipClose = (key: DockFilterKey) => {
    if (!isFilterAtDefault(key, value)) {
      commit(resetFilterValue(key, value), activeFilters);
      setOpen(null);
      return;
    }
    onRemove(key);
  };

  const onClear = () => {
    commit(
      {
        severities: [],
        interactions: [],
        localizations: [],
        statuses: [],
        range: { ...EMPTY_DOCK_RANGE },
        query: value.query,
      },
      [],
    );
    setOpen(null);
  };

  const setRangePreset = (preset: DockRangePreset) => {
    const range: DockRangeFilter =
      preset === 'custom'
        ? { preset: 'custom', from: value.range.from, to: value.range.to }
        : { preset };
    const nextActive: DockFilterKey[] = activeFilters.includes('range')
      ? activeFilters
      : [...activeFilters, 'range'];
    commit({ ...value, range }, nextActive);
  };

  const setCustomDate = (field: 'from' | 'to', ymd: string) => {
    const nextActive: DockFilterKey[] = activeFilters.includes('range')
      ? activeFilters
      : [...activeFilters, 'range'];
    commit(
      {
        ...value,
        range: {
          preset: 'custom',
          from: field === 'from' ? ymd : value.range.from,
          to: field === 'to' ? ymd : value.range.to,
        },
      },
      nextActive,
    );
  };

  const setCustomRange = (from: string, to: string) => {
    const nextActive: DockFilterKey[] = activeFilters.includes('range')
      ? activeFilters
      : [...activeFilters, 'range'];
    commit({ ...value, range: { preset: 'custom', from, to } }, nextActive);
    setOpen(null);
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <div className={styles.chips}>
        <div className={styles.chipWrap}>
          <Tip content="Добавить фильтр">
            <button
              type="button"
              data-filter-trigger="add"
              className={[styles.iconBtn, open === 'add' ? styles.iconBtnActive : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() => toggleOpen('add')}
              aria-label="Добавить фильтр"
            >
              +
            </button>
          </Tip>
          {open === 'add' && (
            <div className={styles.popover} role="menu" ref={popoverRef}>
              {AVAILABLE.map((f) => {
                const on = activeFilters.includes(f.key);
                return (
                  <button
                    key={f.key}
                    type="button"
                    className={styles.option}
                    onClick={() => (on ? onRemove(f.key) : onAdd(f.key))}
                  >
                    <span className={styles.checkMark}>{on ? '✓' : ''}</span>
                    {f.name}
                  </button>
                );
              })}
              <div className={styles.popoverFooter}>
                <button
                  type="button"
                  className={styles.popoverOk}
                  onClick={() => setOpen(null)}
                >
                  OK
                </button>
              </div>
            </div>
          )}
        </div>

        {activeFilters.map((key) => {
          if (key === 'range') {
            const summary = rangeSummary(value.range);
            const isOpen = open === 'range';
            const active =
              value.range.preset !== 'all' ||
              Boolean(value.range.from) ||
              Boolean(value.range.to) ||
              isOpen;
            return (
              <div className={styles.chipWrap} key={key}>
                <div
                  className={[styles.chip, active ? styles.chipActive : ''].filter(Boolean).join(' ')}
                >
                  <button
                    type="button"
                    data-filter-trigger="range"
                    className={styles.chipBody}
                    onClick={() => toggleOpen('range')}
                    aria-expanded={isOpen}
                  >
                    <span className={styles.chipName}>Период</span>
                    {summary && <span className={styles.chipValue}>: {summary}</span>}
                    <span className={[styles.caret, isOpen ? styles.caretOpen : ''].join(' ')}>▾</span>
                  </button>
                  <Tip content={isFilterAtDefault('range', value) ? 'Убрать фильтр' : 'Сбросить фильтр'}>
                    <button
                      type="button"
                      className={styles.chipClose}
                      onClick={() => onChipClose('range')}
                      aria-label={
                        isFilterAtDefault('range', value)
                          ? 'Убрать фильтр «Период»'
                          : 'Сбросить фильтр «Период»'
                      }
                    >
                      ×
                    </button>
                  </Tip>
                </div>
                {isOpen && (
                  <div
                    ref={popoverRef}
                    className={[styles.popover, styles.rangePopover].join(' ')}
                    role="listbox"
                    aria-label="Период"
                  >
                    {DOCK_RANGE_PRESETS.map((p) => {
                      const selected = value.range.preset === p.id;
                      const showCalendar =
                        p.id === 'custom' && value.range.preset === 'custom' && calendarOpen;
                      return (
                        <div key={p.id} className={styles.presetItem}>
                          {showCalendar && (
                            <div className={styles.customOverlay}>
                              {renderDateRange ? (
                                <div className={styles.customRange}>
                                  {renderDateRange({
                                    from: value.range.from,
                                    to: value.range.to,
                                    onApply: (from, to) => setCustomRange(from, to),
                                    onReset: () => setCalendarOpen(false),
                                  })}
                                </div>
                              ) : (
                                <div className={styles.customDates}>
                                  <div className={styles.dateField}>
                                    <span>с</span>
                                    {renderDateField ? (
                                      renderDateField({
                                        value: value.range.from,
                                        onChange: (ymd) => setCustomDate('from', ymd ?? ''),
                                        placeholder: 'Дата',
                                      })
                                    ) : (
                                      <input
                                        type="date"
                                        value={value.range.from ?? ''}
                                        onChange={(e) => setCustomDate('from', e.target.value)}
                                      />
                                    )}
                                  </div>
                                  <div className={styles.dateField}>
                                    <span>по</span>
                                    {renderDateField ? (
                                      renderDateField({
                                        value: value.range.to,
                                        onChange: (ymd) => setCustomDate('to', ymd ?? ''),
                                        placeholder: 'Дата',
                                      })
                                    ) : (
                                      <input
                                        type="date"
                                        value={value.range.to ?? ''}
                                        onChange={(e) => setCustomDate('to', e.target.value)}
                                      />
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            className={[styles.option, selected ? styles.optionActive : '']
                              .filter(Boolean)
                              .join(' ')}
                            onClick={() => {
                              setRangePreset(p.id);
                              setCalendarOpen(p.id === 'custom');
                            }}
                          >
                            <span className={styles.radioMark}>{selected ? '●' : '○'}</span>
                            {p.label}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          const spec = specs[key];
          const summary = summarize(spec);
          const isOpen = open === key;
          const allIds = spec.options.map((o) => o.id);
          const allChecked =
            allIds.length > 0 && allIds.every((id) => spec.selected.includes(id));
          const someChecked = spec.selected.length > 0 && !allChecked;
          return (
            <div className={styles.chipWrap} key={key}>
              <div
                className={[styles.chip, summary || isOpen ? styles.chipActive : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                <button
                  type="button"
                  data-filter-trigger={key}
                  className={styles.chipBody}
                  onClick={() => toggleOpen(key)}
                  aria-expanded={isOpen}
                >
                  <span className={styles.chipName}>{spec.name}</span>
                  {summary && <span className={styles.chipValue}>: {summary}</span>}
                  <span className={[styles.caret, isOpen ? styles.caretOpen : ''].join(' ')}>▾</span>
                </button>
                <Tip content={isFilterAtDefault(key, value) ? 'Убрать фильтр' : 'Сбросить фильтр'}>
                  <button
                    type="button"
                    className={styles.chipClose}
                    onClick={() => onChipClose(key)}
                    aria-label={
                      isFilterAtDefault(key, value)
                        ? `Убрать фильтр «${spec.name}»`
                        : `Сбросить фильтр «${spec.name}»`
                    }
                  >
                    ×
                  </button>
                </Tip>
              </div>
              {isOpen && (
                <div className={styles.popover} ref={popoverRef}>
                  <label className={[styles.check, styles.checkAll].join(' ')}>
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={(el) => {
                        if (el) {
                          el.indeterminate = someChecked;
                        }
                      }}
                      onChange={() => {
                        spec.onChange(allChecked ? [] : allIds);
                      }}
                    />
                    Все
                  </label>
                  <div className={styles.checkDivider} aria-hidden="true" />
                  {spec.options.map((o) => {
                    const checked = spec.selected.includes(o.id);
                    return (
                      <label key={o.id} className={styles.check}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(spec.selected);
                            if (e.target.checked) {
                              next.add(o.id);
                            } else {
                              next.delete(o.id);
                            }
                            spec.onChange([...next]);
                          }}
                        />
                        {o.icon && <span className={styles.optionIcon}>{o.icon}</span>}
                        {o.label}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        <Tip content="Сбросить все фильтры">
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClear}
            disabled={activeFilters.length === 0}
            aria-label="Сбросить все фильтры"
          >
            ×
          </button>
        </Tip>
      </div>

      <div className={styles.right}>
        {total !== undefined && <span className={styles.total}>Найдено: {total}</span>}
        <div className={styles.searchWrap}>
          <svg className={styles.searchIcon} viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              d="M7 2a5 5 0 1 1 0 10A5 5 0 0 1 7 2Zm3.5 8.5L14 14"
            />
          </svg>
          <input
            className={[styles.search, value.query ? styles.searchWithClear : '']
              .filter(Boolean)
              .join(' ')}
            type="text"
            placeholder="Поиск…"
            value={value.query}
            onChange={(e) => onChange({ ...value, query: e.target.value })}
            autoComplete="off"
          />
          {value.query && (
            <Tip content="Очистить поиск">
              <button
                type="button"
                className={styles.searchClear}
                onClick={() => onChange({ ...value, query: '' })}
                aria-label="Очистить поиск"
              >
                ×
              </button>
            </Tip>
          )}
        </div>
      </div>
    </div>
  );
}

function summarize(spec: ChipSpec): string | undefined {
  const labels = spec.selected.map((id) => spec.options.find((o) => o.id === id)?.label ?? id);
  return labels.length > 0 ? labels.join(', ') : undefined;
}
