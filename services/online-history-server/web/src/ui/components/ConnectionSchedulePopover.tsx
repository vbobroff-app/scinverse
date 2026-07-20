import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CalendarDayDto,
  ConnectionScheduleRuleDto,
  ConnectionScheduleStateDto,
  PutConnectionScheduleRuleRequest,
} from '../../core/types';
import { OhsApi } from '../../core/api';
import {
  dictFromRules,
  dowLabelFromIso,
  emptyLayerDict,
  findDateLayer,
  findLayer,
  labelFromDateRange,
  labelFromMask,
  layerIdDate,
  layerIdDow,
  maskFromDays,
  promoteExc,
  promoteStaticExc,
  resolveLayerForDate,
  resolveLayerForDow,
  type ScheduleLayer,
  type ScheduleLayerDict,
} from '../../core/scheduleLayerDict';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { CalendarIcon, EyeIcon, PencilIcon } from './icons';
import { StaticExceptionCalendar } from './StaticExceptionCalendar';
import {
  DAY_MIN,
  HORIZON_HI,
  MAX_SPAN_MIN,
  OPEN_LO,
  ScheduleWindowRibbon,
  templateToAxisMins,
} from './ScheduleWindowRibbon';
import { WeeklyDayColumns, type DayColumn } from './WeeklyDayColumns';
import { WeeklyScheduleOverview, type SchedulePreview } from './WeeklyScheduleOverview';
import styles from './ConnectionSchedulePopover.module.css';

interface Props {
  connectionId: number;
  state: ConnectionScheduleStateDto | undefined;
  open: boolean;
  onClose: () => void;
  onUpsertRule: (body: PutConnectionScheduleRuleRequest) => void;
  onCancelRule: (scheduleId: number) => void;
}

/** Дни недели: Пн..Вс, значение — js dow (0=вс..6=сб). */
const WEEKDAYS: { dow: number; label: string }[] = [
  { dow: 1, label: 'Пн' },
  { dow: 2, label: 'Вт' },
  { dow: 3, label: 'Ср' },
  { dow: 4, label: 'Чт' },
  { dow: 5, label: 'Пт' },
  { dow: 6, label: 'Сб' },
  { dow: 0, label: 'Вс' },
];

type ScopeMode = 'window' | 'off';

const WEEKDAY_DAYS = [1, 2, 3, 4, 5];
const WEEKEND_DAYS = [6, 0];

type TemplateId = 'futures' | 'stock' | 'currency';

const TEMPLATES: { id: TemplateId; label: string; engine: string; market: string }[] = [
  { id: 'futures', label: 'MOEX срочный', engine: 'futures', market: 'derivatives' },
  { id: 'stock', label: 'MOEX фондовый', engine: 'stock', market: 'stock' },
  { id: 'currency', label: 'MOEX валютный', engine: 'currency', market: 'currency' },
];

type DayType = 'weekday' | 'weekend';

interface DayWindow {
  openH: number;
  openM: number;
  closeH: number;
  closeM: number;
}

interface TemplateWindow {
  wd: DayWindow;
  we: DayWindow | null;
}

type PresetMap = Record<TemplateId, TemplateWindow | null>;

const EMPTY_PRESETS: PresetMap = { futures: null, stock: null, currency: null };

const SHIFTS = [0, 1, 2, 3, 4] as const;

const WEEK_JS = [1, 2, 3, 4, 5, 6, 0] as const;

/** Макс. длина static-диапазона (включительно). */
const MAX_STATIC_SPAN_DAYS = 14;
/** Окно графика вокруг одиночной даты. */
const CHART_PAD_DAYS = 3;

function sameDays(a: ReadonlySet<number>, days: number[]): boolean {
  return a.size === days.length && days.every((d) => a.has(d));
}

function dayTypeOf(days: ReadonlySet<number>): DayType {
  return days.size > 0 && [...days].every((d) => d === 0 || d === 6) ? 'weekend' : 'weekday';
}

function pickWindow(w: TemplateWindow | null, dt: DayType): DayWindow | null {
  if (!w) return null;
  return dt === 'weekend' ? w.we : w.wd;
}

function hmParts(hms: string): { h: number; m: number } {
  const [h, m] = hms.split(':');
  return { h: Number(h), m: Number(m) };
}

function fmtWindow(w: DayWindow): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(w.openH)}:${p(w.openM)}–${p(w.closeH)}:${p(w.closeM)}`;
}

function fmtMin(min: number): string {
  const norm = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(norm / 60)).padStart(2, '0')}:${String(norm % 60).padStart(2, '0')}`;
}

function isShiftValid(w: DayWindow | null, pad: number): boolean {
  return w != null && templateToAxisMins(w.openH, w.openM, w.closeH, w.closeM, pad) != null;
}

function addDaysIso(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function eachIsoDays(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = addDaysIso(cur, 1);
    if (out.length > 31) break;
  }
  return out;
}

function fmtDdMm(iso: string): string {
  return `${iso.slice(8)}.${iso.slice(5, 7)}`;
}

type ActiveScope =
  | { kind: 'main' }
  | { kind: 'dow'; days: ReadonlySet<number> }
  | { kind: 'date'; from: string; to: string };

/** Обновить активный слой без смены порядка (порядок — через promote при выборе скоупа). */
function patchActiveLayer(
  dict: ScheduleLayerDict,
  scope: ActiveScope,
  patch: Partial<Pick<ScheduleLayer, 'mode' | 'startMin' | 'endMin'>>,
): ScheduleLayerDict {
  if (scope.kind === 'main') {
    return { ...dict, main: { ...dict.main, ...patch } };
  }

  if (scope.kind === 'date') {
    const id = layerIdDate(scope.from, scope.to);
    const idx = dict.staticExc.findIndex((e) => e.id === id);
    const cur: ScheduleLayer =
      idx >= 0
        ? dict.staticExc[idx]
        : {
            id,
            scopeKind: 'date',
            dowMask: null,
            dateFrom: scope.from,
            dateTo: scope.to,
            label: labelFromDateRange(scope.from, scope.to),
            mode: 'window',
            startMin: dict.main.startMin,
            endMin: dict.main.endMin,
          };
    const next = { ...cur, ...patch };
    if (idx >= 0) {
      const staticExc = dict.staticExc.slice();
      staticExc[idx] = next;
      return { ...dict, staticExc };
    }
    return { ...dict, staticExc: [...dict.staticExc, next] };
  }

  const mask = maskFromDays(scope.days);
  const id = layerIdDow(mask);
  const idx = dict.exc.findIndex((e) => e.id === id);
  const cur: ScheduleLayer =
    idx >= 0
      ? dict.exc[idx]
      : {
          id,
          scopeKind: 'dow',
          dowMask: mask,
          dateFrom: null,
          dateTo: null,
          label: labelFromMask(mask),
          mode: 'window',
          startMin: dict.main.startMin,
          endMin: dict.main.endMin,
        };
  const next = { ...cur, ...patch };
  if (idx >= 0) {
    const exc = dict.exc.slice();
    exc[idx] = next;
    return { ...dict, exc };
  }
  return { ...dict, exc: [...dict.exc, next] };
}

/**
 * Popover расписания Connection (phase 7j v2): выбор скоупа (основное / дни), режим window|off,
 * окно = open+duration на ленте 48h, read-only обзор недели с дорожками правил.
 */
export function ConnectionSchedulePopover({
  connectionId,
  state,
  open,
  onClose,
  onUpsertRule,
  onCancelRule,
}: Props) {
  const store = useOhsStore();
  const highlightDays = useBehavior(store.highlightDays$);

  const rules = useMemo(() => state?.rules ?? [], [state]);

  const [layers, setLayers] = useState<ScheduleLayerDict>(() => emptyLayerDict());
  const [startMin, setStartMin] = useState(6 * 60);
  const [endMin, setEndMin] = useState(DAY_MIN + 60);
  const [engine, setEngine] = useState('futures');
  const [shiftHours, setShiftHours] = useState<number | null>(1);
  const [activeTemplate, setActiveTemplate] = useState<TemplateId | null>('futures');
  /** Скоуп-«основное» (main) vs дни (dow). */
  const [scopeMain, setScopeMain] = useState(true);
  const [weekdays, setWeekdays] = useState<Set<number>>(() => new Set(WEEKDAY_DAYS));
  const [mode, setMode] = useState<ScopeMode>('window');
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<ConnectionScheduleRuleDto[]>([]);
  const [presets, setPresets] = useState<PresetMap>(EMPTY_PRESETS);
  const [editing, setEditing] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  /** Активный static-скоуп (дата или диапазон). */
  const [scopeDate, setScopeDate] = useState<{ from: string; to: string } | null>(null);
  const [calDays, setCalDays] = useState<Map<string, CalendarDayDto>>(() => new Map());
  const calWrapRef = useRef<HTMLDivElement>(null);

  const mergeCalDays = useCallback((days: CalendarDayDto[]) => {
    setCalDays((prev) => {
      const next = new Map(prev);
      for (const d of days) next.set(d.date, d);
      return next;
    });
  }, []);

  const loadCalendarRange = useCallback(
    (from: string, till: string) => {
      const eng = state?.settings.engine ?? 'futures';
      OhsApi.getEngineCalendar(eng, from, till).subscribe({
        next: mergeCalDays,
        error: () => undefined,
      });
    },
    [state?.settings.engine, mergeCalDays],
  );

  const onCalViewChange = useCallback(
    (year: number, month: number) => {
      const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const last = new Date(year, month + 1, 0).getDate();
      const till = `${year}-${String(month + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
      loadCalendarRange(from, till);
    },
    [loadCalendarRange],
  );

  useEffect(() => {
    if (!open) return;
    setScopeMain(true);
    setWeekdays(new Set(WEEKDAY_DAYS));
    setScopeDate(null);
    setMode('window');
    setShiftHours(1);
    setNote('');
    setCalOpen(false);
    setCalDays(new Map());
    setEditing(rules.length === 0);

    const dict = rules.length > 0 ? dictFromRules(rules) : emptyLayerDict();
    setLayers(dict);
    setStartMin(dict.main.startMin);
    setEndMin(dict.main.endMin);
    setMode(dict.main.mode);
    setEngine(state?.settings.engine ?? 'futures');
    setActiveTemplate(TEMPLATES.find((t) => t.engine === (state?.settings.engine ?? 'futures'))?.id ?? 'futures');

    OhsApi.getConnectionScheduleHistory(connectionId).subscribe({
      next: setHistory,
      error: () => setHistory([]),
    });

    setPresets(EMPTY_PRESETS);
    TEMPLATES.forEach((tpl) => {
      OhsApi.getMarketSchedule(tpl.market).subscribe({
        next: (ms) => {
          const wo = hmParts(ms.wdOpen);
          const wc = hmParts(ms.wdClose);
          const weOpen = ms.weOpen ? hmParts(ms.weOpen) : null;
          const weClose = ms.weClose ? hmParts(ms.weClose) : null;
          const we =
            weOpen && weClose
              ? { openH: weOpen.h, openM: weOpen.m, closeH: weClose.h, closeM: weClose.m }
              : null;
          setPresets((prev) => ({
            ...prev,
            [tpl.id]: { wd: { openH: wo.h, openM: wo.m, closeH: wc.h, closeM: wc.m }, we },
          }));
        },
        error: () => setPresets((prev) => ({ ...prev, [tpl.id]: null })),
      });
    });
  }, [open, connectionId, rules, state]);

  useEffect(() => {
    if (!calOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (calWrapRef.current && !calWrapRef.current.contains(e.target as Node)) {
        setCalOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [calOpen]);

  if (!open) return null;

  const readOnly = !editing;
  const dowMask = maskFromDays(weekdays);
  const onDateScope = scopeDate != null;
  const scopeKind = scopeMain ? 'main' : onDateScope ? 'date' : 'dow';
  const activeScope: ActiveScope = scopeMain
    ? { kind: 'main' }
    : onDateScope
      ? { kind: 'date', from: scopeDate.from, to: scopeDate.to }
      : { kind: 'dow', days: weekdays };
  const hasAnyExc = layers.exc.length > 0 || layers.staticExc.length > 0;
  const activeTpl = TEMPLATES.find((t) => t.id === activeTemplate) ?? null;
  const dayType = onDateScope
    ? (() => {
        const js = new Date(`${scopeDate.from}T12:00:00`).getDay();
        return js === 0 || js === 6 ? 'weekend' : 'weekday';
      })()
    : scopeMain
      ? 'weekday'
      : dayTypeOf(weekdays);
  const activeTplWin = activeTemplate ? presets[activeTemplate] : null;
  const activeWin = pickWindow(activeTplWin, dayType);
  const baseAxis = activeWin
    ? templateToAxisMins(activeWin.openH, activeWin.openM, activeWin.closeH, activeWin.closeM, 0)
    : null;

  const loadEditorFromLayer = (layer: ScheduleLayer) => {
    setMode(layer.mode);
    setStartMin(layer.startMin);
    setEndMin(layer.endMin);
  };

  const chooseScope = (main: boolean, days: number[] | null) => {
    if (readOnly) return;
    setScopeDate(null);
    setScopeMain(main);
    const nextDays = days ? new Set(days) : weekdays;
    if (days) setWeekdays(nextDays);

    if (main) {
      loadEditorFromLayer(layers.main);
      return;
    }

    const mask = maskFromDays(nextDays);
    const dt = dayTypeOf(nextDays);
    const existing = findLayer(layers, false, nextDays);

    let start = layers.main.startMin;
    let end = layers.main.endMin;
    let layerMode: ScopeMode = 'window';

    if (existing) {
      start = existing.startMin;
      end = existing.endMin;
      layerMode = existing.mode;
    } else if (activeTpl && shiftHours != null) {
      const w = pickWindow(presets[activeTpl.id], dt);
      const axis = w
        ? templateToAxisMins(w.openH, w.openM, w.closeH, w.closeM, shiftHours)
        : null;
      if (axis) {
        start = axis.startMin;
        end = axis.endMin;
      }
    }

    const layer: ScheduleLayer = {
      id: layerIdDow(mask),
      scopeKind: 'dow',
      dowMask: mask,
      dateFrom: null,
      dateTo: null,
      label: labelFromMask(mask),
      mode: layerMode,
      startMin: start,
      endMin: end,
    };
    setLayers((prev) => promoteExc(prev, layer));
    loadEditorFromLayer(layer);
  };

  const chooseDateScope = (from: string, to: string) => {
    if (readOnly) return;
    setCalOpen(false);
    setScopeMain(false);
    setScopeDate({ from, to });

    const existing = findDateLayer(layers, from, to);
    let start = layers.main.startMin;
    let end = layers.main.endMin;
    let layerMode: ScopeMode = 'window';

    if (existing) {
      start = existing.startMin;
      end = existing.endMin;
      layerMode = existing.mode;
    } else if (activeTpl && shiftHours != null) {
      const js = new Date(`${from}T12:00:00`).getDay();
      const dt: DayType = js === 0 || js === 6 ? 'weekend' : 'weekday';
      const w = pickWindow(presets[activeTpl.id], dt);
      const axis = w
        ? templateToAxisMins(w.openH, w.openM, w.closeH, w.closeM, shiftHours)
        : null;
      if (axis) {
        start = axis.startMin;
        end = axis.endMin;
      }
    }

    const layer: ScheduleLayer = {
      id: layerIdDate(from, to),
      scopeKind: 'date',
      dowMask: null,
      dateFrom: from,
      dateTo: to,
      label: labelFromDateRange(from, to),
      mode: layerMode,
      startMin: start,
      endMin: end,
    };
    setLayers((prev) => promoteStaticExc(prev, layer, { dropNested: true }));
    loadEditorFromLayer(layer);

    const single = from === to;
    const chartFrom = single ? addDaysIso(from, -CHART_PAD_DAYS) : from;
    const chartTo = single ? addDaysIso(to, CHART_PAD_DAYS) : to;
    loadCalendarRange(chartFrom, chartTo);
  };

  const toggleDay = (dow: number, exclusive = false) => {
    if (readOnly) return;
    if (exclusive) {
      chooseScope(false, [dow]);
      return;
    }
    const next = new Set(onDateScope ? [] : weekdays);
    if (onDateScope) {
      next.add(dow);
    } else if (next.has(dow)) {
      if (next.size > 1) next.delete(dow);
    } else {
      next.add(dow);
    }
    chooseScope(false, [...next]);
  };

  const clearExceptions = () => {
    if (readOnly) return;
    setCalOpen(false);
    setScopeDate(null);
    const main = layers.main;
    setLayers({ main, exc: [], staticExc: [] });
    setScopeMain(true);
    loadEditorFromLayer(main);
  };

  const clearStaticExceptions = () => {
    if (readOnly) return;
    setLayers((prev) => ({ ...prev, staticExc: [] }));
    if (scopeDate) {
      setScopeDate(null);
      setScopeMain(true);
      loadEditorFromLayer(layers.main);
    }
  };

  const setWindow = (s: number, e: number) => {
    const start = Math.max(OPEN_LO, Math.min(s, DAY_MIN - 5));
    let end = Math.max(start + 5, e);
    end = Math.min(end, start + MAX_SPAN_MIN, HORIZON_HI);
    setStartMin(start);
    setEndMin(end);
    setLayers((prev) =>
      patchActiveLayer(prev, activeScope, { startMin: start, endMin: end, mode: 'window' }),
    );
  };

  const setScopeMode = (m: ScopeMode) => {
    setMode(m);
    setLayers((prev) => patchActiveLayer(prev, activeScope, { mode: m }));
  };

  const applyTemplate = (tpl: (typeof TEMPLATES)[number], pad: number | null, dt: DayType = dayType) => {
    const w = pickWindow(presets[tpl.id], dt);
    if (!w) return;
    const base = templateToAxisMins(w.openH, w.openM, w.closeH, w.closeM, 0);
    if (!base) return;

    if (pad == null) {
      // Только подсказка: выбрать шаблон + подтянуть края, лежащие внутри base.
      // Не расширяем окно за duration ≤24ч (иначе 12:00→06:50 при end=+24ч даёт 29ч).
      setEngine(tpl.engine);
      setActiveTemplate(tpl.id);
      setShiftHours(null);
      let s = startMin;
      let e = endMin;
      if (s > base.startMin && s < base.endMin) {
        const cand = base.startMin;
        if (e - cand <= MAX_SPAN_MIN) s = cand;
      }
      if (e > base.startMin && e < base.endMin) {
        const cand = base.endMin;
        if (cand - s <= MAX_SPAN_MIN) e = cand;
      }
      if (e <= s) {
        s = base.startMin;
        e = base.endMin;
      }
      setWindow(s, e);
      return;
    }

    const axis = templateToAxisMins(w.openH, w.openM, w.closeH, w.closeM, pad);
    if (!axis) return;
    setEngine(tpl.engine);
    setActiveTemplate(tpl.id);
    setShiftHours(pad);
    setWindow(axis.startMin, axis.endMin);
  };

  const selectShift = (pad: number) => {
    if (!activeTpl || !isShiftValid(activeWin, pad)) return;
    applyTemplate(activeTpl, pad);
  };

  const onWindowChange = (s: number, e: number) => {
    setWindow(s, e);
    setShiftHours(null);
    if (!activeTpl || !baseAxis) return;
    if (s > baseAxis.startMin || e < baseAxis.endMin) setActiveTemplate(null);
  };

  const openHm = fmtMin(startMin);
  const durationMin = Math.min(Math.max(endMin - startMin, 1), 1439);
  const durationLabel =
    mode === 'off' ? 'выкл' : `${openHm} · ${Math.floor(durationMin / 60)}ч ${durationMin % 60}м`;

  const chartColumns: DayColumn[] = onDateScope
    ? (() => {
        const single = scopeDate.from === scopeDate.to;
        const from = single ? addDaysIso(scopeDate.from, -CHART_PAD_DAYS) : scopeDate.from;
        const to = single ? addDaysIso(scopeDate.to, CHART_PAD_DAYS) : scopeDate.to;
        return eachIsoDays(from, to).map((iso) => {
          const w = resolveLayerForDate(layers, iso);
          const cal = calDays.get(iso);
          const inScope = iso >= scopeDate.from && iso <= scopeDate.to;
          const js = new Date(`${iso}T12:00:00`).getDay();
          const dayMoexWin =
            activeTplWin != null
              ? pickWindow(activeTplWin, js === 0 || js === 6 ? 'weekend' : 'weekday')
              : null;
          const dayMoex = dayMoexWin
            ? templateToAxisMins(dayMoexWin.openH, dayMoexWin.openM, dayMoexWin.closeH, dayMoexWin.closeM, 0)
            : null;
          return {
            key: iso,
            label: `${dowLabelFromIso(iso)} ${fmtDdMm(iso)}`,
            seg: {
              mode: w.mode,
              startMin: w.startMin,
              endMin: w.endMin,
              active: inScope,
              baseStartMin: dayMoex?.startMin ?? null,
              baseEndMin: dayMoex?.endMin ?? null,
              nonTrading: cal != null ? !cal.isTrading : undefined,
            },
          };
        });
      })()
    : WEEK_JS.map((js) => {
        const w = resolveLayerForDow(layers, js);
        const active = scopeMain || weekdays.has(js);
        const dayMoexWin =
          activeTplWin != null
            ? pickWindow(activeTplWin, js === 0 || js === 6 ? 'weekend' : 'weekday')
            : null;
        const dayMoex = dayMoexWin
          ? templateToAxisMins(dayMoexWin.openH, dayMoexWin.openM, dayMoexWin.closeH, dayMoexWin.closeM, 0)
          : null;
        return {
          key: String(js),
          label: WEEKDAYS.find((x) => x.dow === js)?.label ?? String(js),
          seg: {
            mode: w.mode,
            startMin: w.startMin,
            endMin: w.endMin,
            active,
            baseStartMin: dayMoex?.startMin ?? null,
            baseEndMin: dayMoex?.endMin ?? null,
          },
        };
      });

  const preview: SchedulePreview = {
    scopeKind,
    dowMask: scopeKind === 'dow' ? dowMask : null,
    dateFrom: scopeKind === 'date' && scopeDate ? scopeDate.from : null,
    dateTo: scopeKind === 'date' && scopeDate ? scopeDate.to : null,
    mode,
    open: mode === 'window' ? `${openHm}:00` : null,
    durationMin: mode === 'window' ? durationMin : null,
  };

  const approve = () => {
    if (readOnly) return;
    if (scopeKind === 'dow' && dowMask === 0) return;
    if (scopeKind === 'date' && !scopeDate) return;
    const scopeText =
      scopeKind === 'main'
        ? 'основное'
        : scopeKind === 'date' && scopeDate
          ? labelFromDateRange(scopeDate.from, scopeDate.to)
          : WEEKDAYS.filter((w) => weekdays.has(w.dow)).map((w) => w.label).join(',');
    if (!window.confirm(`Утвердить правило «${scopeText}»?`)) return;
    const body: PutConnectionScheduleRuleRequest =
      mode === 'off'
        ? {
            scopeKind,
            dowMask: scopeKind === 'dow' ? dowMask : null,
            dateFrom: scopeKind === 'date' && scopeDate ? scopeDate.from : null,
            dateTo: scopeKind === 'date' && scopeDate ? scopeDate.to : null,
            mode: 'off',
            changeSource: 'ui',
            changeNote: note.trim() || null,
          }
        : {
            scopeKind,
            dowMask: scopeKind === 'dow' ? dowMask : null,
            dateFrom: scopeKind === 'date' && scopeDate ? scopeDate.from : null,
            dateTo: scopeKind === 'date' && scopeDate ? scopeDate.to : null,
            mode: 'window',
            open: `${openHm}:00`,
            durationMin,
            changeSource: 'ui',
            changeNote: note.trim() || null,
          };
    onUpsertRule(body);
    onClose();
  };

  return (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div
        className={[styles.panel, calOpen ? styles.panelCalFocus : ''].filter(Boolean).join(' ')}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Расписание соединения"
      >
        {calOpen && (
          <div
            className={styles.calScrim}
            onClick={() => setCalOpen(false)}
            aria-hidden="true"
          />
        )}
        <header className={styles.head}>
          <strong>Расписание соединения</strong>
          <div className={styles.headActions}>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => setEditing((v) => !v)}
              title={editing ? 'Режим редактирования' : 'Режим просмотра'}
              aria-pressed={editing}
            >
              {editing ? <PencilIcon className={styles.headIcon} /> : <EyeIcon className={styles.headIcon} />}
            </button>
            <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Закрыть">
              <span className={styles.closeGlyph} aria-hidden="true">
                ×
              </span>
            </button>
          </div>
        </header>

        <ScheduleWindowRibbon
          startMin={startMin}
          endMin={endMin}
          highlightDays={highlightDays}
          readOnly={readOnly || mode === 'off'}
          off={mode === 'off'}
          baseStartMin={baseAxis?.startMin ?? null}
          baseEndMin={baseAxis?.endMin ?? null}
          durationLabel={durationLabel}
          onChange={onWindowChange}
        />

        <div className={[styles.section, readOnly ? styles.sectionLocked : ''].filter(Boolean).join(' ')}>
          <span className={styles.sectionTitle}>Область правила</span>
          <div className={styles.chips}>
            <button
              type="button"
              className={[styles.chip, scopeMain && !onDateScope ? styles.chipOn : ''].filter(Boolean).join(' ')}
              disabled={readOnly}
              onClick={() => chooseScope(true, null)}
              title="Основное расписание (все дни, база)"
            >
              Все
            </button>
            <button
              type="button"
              className={styles.chip}
              disabled={readOnly || !hasAnyExc}
              onClick={clearExceptions}
              title="Сбросить все исключения (periodical + static)"
            >
              Очистить
            </button>
          </div>
          <div className={styles.chips}>
            <button
              type="button"
              className={[
                styles.chip,
                !scopeMain && !onDateScope && sameDays(weekdays, WEEKDAY_DAYS) ? styles.chipOn : '',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={readOnly}
              onClick={() => chooseScope(false, WEEKDAY_DAYS)}
            >
              Будни
            </button>
            <button
              type="button"
              className={[
                styles.chip,
                !scopeMain && !onDateScope && sameDays(weekdays, WEEKEND_DAYS) ? styles.chipOn : '',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={readOnly}
              onClick={() => chooseScope(false, WEEKEND_DAYS)}
            >
              Сб, Вс
            </button>
            <div className={[styles.calWrap, calOpen ? styles.calWrapOpen : ''].filter(Boolean).join(' ')} ref={calWrapRef}>
              <button
                type="button"
                className={[styles.chip, onDateScope || calOpen ? styles.chipOn : ''].filter(Boolean).join(' ')}
                disabled={readOnly}
                aria-expanded={calOpen}
                onClick={(e) => {
                  setCalOpen((o) => !o);
                  // Убрать :focus-visible — иначе chipOn + outline = двойная рамка.
                  e.currentTarget.blur();
                }}
                title="Static-исключение по дате или диапазону"
              >
                <CalendarIcon className={styles.chipIcon} />
                Календарь
              </button>
              {calOpen && (
                <div className={styles.calPop}>
                  <StaticExceptionCalendar
                    exceptions={layers.staticExc
                      .filter((e) => e.dateFrom && e.dateTo)
                      .map((e) => ({
                        from: e.dateFrom!,
                        to: e.dateTo!,
                        mode: e.mode,
                      }))}
                    maxSpanDays={MAX_STATIC_SPAN_DAYS}
                    isNonTrading={(iso) => (calDays.has(iso) ? !calDays.get(iso)!.isTrading : false)}
                    onViewChange={onCalViewChange}
                    onGo={chooseDateScope}
                    onClearAll={clearStaticExceptions}
                    onDismiss={() => setCalOpen(false)}
                  />
                </div>
              )}
            </div>
          </div>
          <div className={styles.days}>
            {WEEKDAYS.map((w) => (
              <button
                key={w.dow}
                type="button"
                className={[
                  styles.day,
                  !scopeMain && !onDateScope && weekdays.has(w.dow) ? styles.dayOn : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={readOnly}
                onClick={(e) => toggleDay(w.dow, e.ctrlKey || e.metaKey)}
              >
                {w.label}
              </button>
            ))}
          </div>
          {onDateScope && scopeDate && (
            <span className={styles.meta}>
              Static · {labelFromDateRange(scopeDate.from, scopeDate.to)}
            </span>
          )}
        </div>

        <div className={[styles.section, readOnly ? styles.sectionLocked : ''].filter(Boolean).join(' ')}>
          <span className={styles.sectionTitle}>Режим</span>
          <div className={styles.chips}>
            <button
              type="button"
              className={[styles.chip, mode === 'window' ? styles.chipOn : ''].filter(Boolean).join(' ')}
              disabled={readOnly}
              onClick={() => setScopeMode('window')}
            >
              Окно связи
            </button>
            <button
              type="button"
              className={[styles.chip, mode === 'off' ? styles.chipOn : ''].filter(Boolean).join(' ')}
              disabled={readOnly}
              onClick={() => setScopeMode('off')}
              title="Нерабочий период (не подключаться)"
            >
              Выключено
            </button>
          </div>
        </div>

        <div
          className={[styles.section, readOnly || mode === 'off' ? styles.sectionLocked : '']
            .filter(Boolean)
            .join(' ')}
        >
          <span className={styles.sectionTitle}>Шаблоны (подсказки)</span>
          <div className={styles.chips}>
            {TEMPLATES.map((tpl) => {
              const w = pickWindow(presets[tpl.id], dayType);
              const canApply = w != null && (shiftHours == null || isShiftValid(w, shiftHours));
              return (
                <button
                  key={tpl.id}
                  type="button"
                  className={[styles.chip, activeTemplate === tpl.id ? styles.chipOn : '']
                    .filter(Boolean)
                    .join(' ')}
                  disabled={readOnly || mode === 'off' || !canApply}
                  onClick={() => applyTemplate(tpl, shiftHours)}
                >
                  {tpl.label}
                </button>
              );
            })}
            <span className={styles.divider} />
            {SHIFTS.map((n) => (
              <button
                key={n}
                type="button"
                className={[styles.chip, shiftHours === n ? styles.chipOn : ''].filter(Boolean).join(' ')}
                disabled={readOnly || mode === 'off' || !isShiftValid(activeWin, n)}
                onClick={() => selectShift(n)}
                title={
                  isShiftValid(activeWin, n)
                    ? `±${n} ч к границам шаблона`
                    : 'Shift недоступен: open уйдёт во вчера / не сегодня, или duration >24ч'
                }
              >
                {n === 0 ? 'Shift 0' : String(n)}
              </button>
            ))}
          </div>
          {activeTplWin && (
            <span className={styles.meta}>
              Из market_schedule ·{' '}
              <span className={dayType === 'weekday' ? styles.metaActive : undefined}>
                будни {fmtWindow(activeTplWin.wd)}
              </span>
              {' · '}
              <span className={dayType === 'weekend' ? styles.metaActive : undefined}>
                выходные {activeTplWin.we ? fmtWindow(activeTplWin.we) : 'нет торгов'}
              </span>
            </span>
          )}
        </div>

        <label className={styles.note}>
          Комментарий
          <input
            type="text"
            value={note}
            placeholder="например: брокер рвёт до 07:00"
            disabled={readOnly}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <WeeklyScheduleOverview
          rules={rules}
          preview={editing ? preview : null}
          onCancelRule={editing ? onCancelRule : undefined}
        />

        <WeeklyDayColumns
          key={onDateScope && scopeDate ? `date:${scopeDate.from}:${scopeDate.to}` : 'week'}
          columns={chartColumns}
          title={onDateScope ? 'Даты' : 'Неделя'}
          defaultExpanded
        />

        <button
          type="button"
          className={styles.approve}
          onClick={approve}
          disabled={readOnly}
          title={readOnly ? 'Переключитесь в режим редактирования' : undefined}
        >
          Утвердить
        </button>

        {history.length > 0 && (
          <section className={styles.history}>
            <h4>История</h4>
            <ul>
              {history.slice(0, 12).map((h) => (
                <li key={h.scheduleId}>
                  <span>
                    {h.mode === 'off'
                      ? 'выкл'
                      : h.open
                        ? `${h.open.slice(0, 5)}–${(h.end ?? '').slice(0, 5)}`
                        : '—'}{' '}
                    · {h.scopeKind}
                    {h.closeReason ? ` · ${h.closeReason}` : ''}
                  </span>
                  <span className={styles.meta}>
                    {new Date(h.effectiveFrom).toLocaleString('ru-RU')} · {h.changeSource}
                    {h.changeNote ? ` · ${h.changeNote}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
