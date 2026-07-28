import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  NotificationInteraction,
  NotificationLocalization,
  NotificationSeverity,
  NotificationStatus,
  ThreadStatus,
} from '../types';
import {
  DEFAULT_TIME_FROM,
  DEFAULT_TIME_TO,
  DOCK_RANGE_PRESETS,
  EMPTY_DOCK_RANGE,
  normalizeLocalHm,
  pickRangeTime,
  rangeSummary,
  type DockRangeFilter,
  type DockRangePreset,
} from '../filter/dateRange';
import type { NcChoiceFilter } from '../filter/filterItems';
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
  /**
   * Settings «Группировать». Off — скрыть фильтр «Статус нити» (плоский список, status атома).
   * Default true.
   */
  groupIntoThreads?: boolean;
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
  { key: 'threadStatus', name: 'Статус нити' },
  { key: 'choice', name: 'Выбор' },
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

const THREAD_STATUS_OPTIONS: FilterOption[] = [
  { id: 'active', label: 'Active' },
  { id: 'recovering', label: 'Recovering' },
  { id: 'resolved', label: 'Resolved' },
];

const CHOICE_OPTIONS: FilterOption[] = [
  { id: 'favorite', label: '★ Избранные' },
  { id: 'left', label: '⊘ Скрыть спам' },
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
  if (key === 'threadStatus') {
    return value.threadStatuses.length === 0;
  }
  if (key === 'choice') {
    return value.choices.length === 0;
  }
  return (value.range.preset === 'all' || !value.range.preset) && !value.range.timeEnabled;
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
  if (key === 'threadStatus') {
    return { ...value, threadStatuses: [] };
  }
  if (key === 'choice') {
    return { ...value, choices: [] };
  }
  return { ...value, range: { ...EMPTY_DOCK_RANGE } };
}

/**
 * Плашки фильтров дока в стиле provider workspace:
 * слева [+] · плашки · [×], справа «Найдено» + поиск с иконкой.
 *
 * Поповеры якорятся к чипу: по умолчанию вниз; если снизу не хватает места — вверх.
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
  groupIntoThreads = true,
}: Props) {
  const value = normalizeDockFilter(valueProp);
  const availableFilters = groupIntoThreads
    ? AVAILABLE
    : AVAILABLE.filter((f) => f.key !== 'threadStatus');
  const visibleActiveFilters = groupIntoThreads
    ? activeFilters
    : activeFilters.filter((k) => k !== 'threadStatus');
  const [open, setOpen] = useState<OpenKey>(null);
  // Календарь «ввести даты» показываем только по явному клику, не автоматически при custom.
  const [calendarOpen, setCalendarOpen] = useState(false);
  /** down = ниже чипа (дефолт), up = выше, если снизу не влезает. */
  const [popoverPlacement, setPopoverPlacement] = useState<'down' | 'up'>('down');
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
    if (open === null) {
      setPopoverPlacement('down');
    }
  }, [open, onMenuOpenChange]);

  // Flip: вниз по умолчанию; вверх, только если снизу не хватает высоты меню.
  useLayoutEffect(() => {
    if (open === null) {
      return;
    }
    const trigger = rootRef.current?.querySelector(`[data-filter-trigger="${open}"]`);
    const pop = popoverRef.current;
    if (!(trigger instanceof HTMLElement) || !pop) {
      return;
    }

    const GAP = 4;
    const PAD = 8;
    const MAX = 420;

    const place = () => {
      const t = trigger.getBoundingClientRect();
      const spaceBelow = window.innerHeight - t.bottom - GAP - PAD;
      const spaceAbove = t.top - GAP - PAD;
      // Снимаем жёсткий лимит, чтобы измерить естественную высоту содержимого.
      pop.style.maxHeight = `${MAX}px`;
      const needed = Math.min(pop.scrollHeight, MAX);
      // Вниз по умолчанию; вверх — только если снизу не влезает.
      const placement: 'down' | 'up' = spaceBelow >= needed ? 'down' : 'up';
      setPopoverPlacement(placement);
      const avail = placement === 'down' ? spaceBelow : Math.max(spaceAbove, 120);
      pop.style.maxHeight = `${Math.max(120, Math.min(MAX, avail))}px`;
    };

    place();
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('resize', place);
      pop.style.maxHeight = '';
    };
  }, [open, calendarOpen, value.range]);

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
      threadStatus: {
        key: 'threadStatus',
        name: 'Статус нити',
        options: THREAD_STATUS_OPTIONS,
        selected: value.threadStatuses,
        onChange: (selected) =>
          onChange({ ...value, threadStatuses: selected as ThreadStatus[] }),
      },
      choice: {
        key: 'choice',
        name: 'Выбор',
        options: CHOICE_OPTIONS,
        selected: value.choices,
        onChange: (selected) => onChange({ ...value, choices: selected as NcChoiceFilter[] }),
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
        threadStatuses: [],
        choices: [],
        range: { ...EMPTY_DOCK_RANGE },
        query: value.query,
      },
      [],
    );
    setOpen(null);
  };

  const withRangeActive = (range: DockRangeFilter) => {
    const nextActive: DockFilterKey[] = activeFilters.includes('range')
      ? activeFilters
      : [...activeFilters, 'range'];
    commit({ ...value, range }, nextActive);
  };

  const setRangePreset = (preset: DockRangePreset) => {
    const time = pickRangeTime(value.range);
    const range: DockRangeFilter =
      preset === 'custom'
        ? { preset: 'custom', from: value.range.from, to: value.range.to, ...time }
        : { preset, ...time };
    withRangeActive(range);
  };

  const setCustomDate = (field: 'from' | 'to', ymd: string) => {
    withRangeActive({
      preset: 'custom',
      from: field === 'from' ? ymd : value.range.from,
      to: field === 'to' ? ymd : value.range.to,
      ...pickRangeTime(value.range),
    });
  };

  const setCustomRange = (from: string, to: string) => {
    withRangeActive({
      preset: 'custom',
      from,
      to,
      ...pickRangeTime(value.range),
    });
    setOpen(null);
  };

  const setTimeEnabled = (enabled: boolean) => {
    withRangeActive({
      ...value.range,
      timeEnabled: enabled,
      timeFrom: value.range.timeFrom ?? DEFAULT_TIME_FROM,
      timeTo: value.range.timeTo ?? DEFAULT_TIME_TO,
    });
  };

  const setTimeField = (field: 'timeFrom' | 'timeTo', raw: string) => {
    withRangeActive({
      ...value.range,
      timeEnabled: true,
      timeFrom: value.range.timeFrom ?? DEFAULT_TIME_FROM,
      timeTo: value.range.timeTo ?? DEFAULT_TIME_TO,
      [field]: raw,
    });
  };

  const commitTimeField = (field: 'timeFrom' | 'timeTo', raw: string) => {
    const allow24 = field === 'timeTo';
    const fallback = field === 'timeFrom' ? DEFAULT_TIME_FROM : DEFAULT_TIME_TO;
    setTimeField(field, normalizeLocalHm(raw, fallback, allow24));
  };

  const popoverClass = (...extra: Array<string | false | undefined>) =>
    [styles.popover, popoverPlacement === 'up' ? styles.popoverUp : '', ...extra]
      .filter(Boolean)
      .join(' ');

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
            <div className={popoverClass()} role="menu" ref={popoverRef}>
              {availableFilters.map((f) => {
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

        {visibleActiveFilters.map((key) => {
          if (key === 'range') {
            const summary = rangeSummary(value.range);
            const isOpen = open === 'range';
            const active =
              value.range.preset !== 'all' ||
              Boolean(value.range.from) ||
              Boolean(value.range.to) ||
              Boolean(value.range.timeEnabled) ||
              isOpen;
            const timeFrom = value.range.timeFrom ?? DEFAULT_TIME_FROM;
            const timeTo = value.range.timeTo ?? DEFAULT_TIME_TO;
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
                    className={popoverClass(styles.rangePopover)}
                    role="group"
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
                    <div className={styles.checkDivider} aria-hidden="true" />
                    <label className={styles.check}>
                      <input
                        type="checkbox"
                        checked={Boolean(value.range.timeEnabled)}
                        onChange={(e) => setTimeEnabled(e.target.checked)}
                      />
                      ввести время
                    </label>
                    <div
                      className={[
                        styles.timeRow,
                        value.range.timeEnabled ? '' : styles.timeRowDisabled,
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <input
                        type="text"
                        inputMode="numeric"
                        className={styles.timeInput}
                        value={timeFrom}
                        disabled={!value.range.timeEnabled}
                        placeholder={DEFAULT_TIME_FROM}
                        aria-label="Время с"
                        onChange={(e) => setTimeField('timeFrom', e.target.value)}
                        onBlur={(e) => commitTimeField('timeFrom', e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                      />
                      <span className={styles.timeSep}>–</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        className={styles.timeInput}
                        value={timeTo}
                        disabled={!value.range.timeEnabled}
                        placeholder={DEFAULT_TIME_TO}
                        aria-label="Время по"
                        onChange={(e) => setTimeField('timeTo', e.target.value)}
                        onBlur={(e) => commitTimeField('timeTo', e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                      />
                    </div>
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
                <div className={popoverClass()} ref={popoverRef}>
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
