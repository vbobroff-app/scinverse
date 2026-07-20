import { Tip } from '@scinverse/notification-center';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CalendarDayDto,
  ConnectionScheduleRuleDto,
  ConnectionScheduleStateDto,
  PutConnectionScheduleRuleRequest,
} from '../../core/types';
import { OhsApi } from '../../core/api';
import {
  createStaticExc,
  daysFromMask,
  defaultMainLayer,
  dictFromRules,
  dowLabelFromIso,
  emptyLayerDict,
  findDateLayer,
  findGroupExc,
  findLayer,
  findSingleDayExc,
  isGroupMask,
  labelFromDateRange,
  labelFromMask,
  layerIdDate,
  layerIdDow,
  layerIdMain,
  maskFromDays,
  normalizeRegularExc,
  promoteExc,
  regularBoardSlots,
  removeExcById,
  resolveLayerForDate,
  resolveLayerForDow,
  unionStaticComponentRange,
  type ScheduleLayer,
  type ScheduleLayerDict,
} from '../../core/scheduleLayerDict';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { CalendarIcon, EyeIcon, PencilIcon } from './icons';
import { layerTone, StaticExceptionCalendar } from './StaticExceptionCalendar';
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

/** Длительность enter/exit анимации модалки и календаря (см. CSS). */
const CLOSE_ANIM_MS = 180;

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
    if (out.length > 62) break;
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

/** Round-trip память окна/режима по id слоя (main / dow:N / date:…). */
type LayerMemory = Pick<ScheduleLayer, 'mode' | 'startMin' | 'endMin'>;

function memFromLayer(layer: Pick<ScheduleLayer, 'mode' | 'startMin' | 'endMin'>): LayerMemory {
  return { mode: layer.mode, startMin: layer.startMin, endMin: layer.endMin };
}

function seedLayerMemory(mem: Map<string, LayerMemory>, dict: ScheduleLayerDict): void {
  mem.clear();
  if (dict.main) mem.set(dict.main.id, memFromLayer(dict.main));
  for (const e of dict.exc) mem.set(e.id, memFromLayer(e));
  for (const e of dict.staticExc) mem.set(e.id, memFromLayer(e));
}

/** Обновить активный слой без смены порядка (порядок static — createStaticExc; regular — normalize). */
function patchOneDowLayer(
  dict: ScheduleLayerDict,
  mask: number,
  patch: Partial<Pick<ScheduleLayer, 'mode' | 'startMin' | 'endMin'>>,
  seed: ScheduleLayer,
): ScheduleLayerDict {
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
          startMin: seed.startMin,
          endMin: seed.endMin,
        };
  const next = { ...cur, ...patch };
  if (idx >= 0) {
    const exc = dict.exc.slice();
    exc[idx] = next;
    return { ...dict, exc: normalizeRegularExc(exc) };
  }
  return { ...dict, exc: normalizeRegularExc([...dict.exc, next]) };
}

function patchActiveLayer(
  dict: ScheduleLayerDict,
  scope: ActiveScope,
  patch: Partial<Pick<ScheduleLayer, 'mode' | 'startMin' | 'endMin'>>,
): ScheduleLayerDict {
  const seed = dict.main ?? defaultMainLayer();

  if (scope.kind === 'main') {
    if (!dict.main) return dict;
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
            startMin: seed.startMin,
            endMin: seed.endMin,
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
  // Ctrl multi: Пн+Ср… — правим каждый single отдельно (не одну маску).
  if (scope.days.size > 1 && !isGroupMask(mask)) {
    let next = dict;
    for (const d of scope.days) {
      next = patchOneDowLayer(next, maskFromDays(new Set([d])), patch, seed);
    }
    return next;
  }
  return patchOneDowLayer(dict, mask, patch, seed);
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
  /** Календарь смонтирован (включая фазу закрытия). */
  const [calPresent, setCalPresent] = useState(false);
  const [calExiting, setCalExiting] = useState(false);
  const calOpen = calPresent && !calExiting;
  /** Модалка смонтирована (включая фазу закрытия). */
  const [panelPresent, setPanelPresent] = useState(open);
  const [panelExiting, setPanelExiting] = useState(false);
  /** Активный static-скоуп (дата или диапазон). */
  const [scopeDate, setScopeDate] = useState<{ from: string; to: string } | null>(null);
  const [calDays, setCalDays] = useState<Map<string, CalendarDayDto>>(() => new Map());
  const calWrapRef = useRef<HTMLDivElement>(null);
  /** Память last-known окна слоя на сессию поповера (снял → вернул). */
  const layerMemRef = useRef<Map<string, LayerMemory>>(new Map());

  const rememberLayer = useCallback((id: string, mem: LayerMemory) => {
    layerMemRef.current.set(id, mem);
  }, []);

  const recallLayer = useCallback((id: string): LayerMemory | undefined => {
    return layerMemRef.current.get(id);
  }, []);

  const closeMs = () =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 0
      : CLOSE_ANIM_MS;

  const openCalendar = useCallback(() => {
    setCalPresent(true);
    setCalExiting(false);
  }, []);

  const closeCalendar = useCallback(() => {
    setCalPresent((present) => {
      if (!present) return false;
      setCalExiting(true);
      return true;
    });
  }, []);

  const closeCalendarInstant = useCallback(() => {
    setCalPresent(false);
    setCalExiting(false);
  }, []);

  useEffect(() => {
    if (!calExiting) return;
    const t = window.setTimeout(() => {
      setCalPresent(false);
      setCalExiting(false);
    }, closeMs());
    return () => window.clearTimeout(t);
  }, [calExiting]);

  useEffect(() => {
    if (open) {
      setPanelPresent(true);
      setPanelExiting(false);
      return;
    }
    setPanelPresent((present) => {
      if (!present) return false;
      setPanelExiting(true);
      return true;
    });
  }, [open]);

  useEffect(() => {
    if (!panelExiting) return;
    const t = window.setTimeout(() => {
      setPanelPresent(false);
      setPanelExiting(false);
      closeCalendarInstant();
    }, closeMs());
    return () => window.clearTimeout(t);
  }, [panelExiting, closeCalendarInstant]);

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
    setMode('window');
    setShiftHours(1);
    setNote('');
    closeCalendarInstant();
    setCalDays(new Map());
    setEditing(rules.length === 0);

    const dict = rules.length > 0 ? dictFromRules(rules) : emptyLayerDict();
    setLayers(dict);
    seedLayerMemory(layerMemRef.current, dict);
    if (dict.main) {
      setScopeMain(true);
      setWeekdays(new Set(WEEKDAY_DAYS));
      setScopeDate(null);
      setStartMin(dict.main.startMin);
      setEndMin(dict.main.endMin);
      setMode(dict.main.mode);
    } else {
      setScopeMain(false);
      const group = findGroupExc(dict);
      if (group?.dowMask != null) {
        setWeekdays(new Set(daysFromMask(group.dowMask)));
        setStartMin(group.startMin);
        setEndMin(group.endMin);
        setMode(group.mode);
      } else {
        const first = dict.exc[0];
        if (first?.dowMask != null) {
          setWeekdays(new Set(daysFromMask(first.dowMask)));
          setStartMin(first.startMin);
          setEndMin(first.endMin);
          setMode(first.mode);
        } else {
          setWeekdays(new Set());
          setStartMin(6 * 60);
          setEndMin(DAY_MIN + 60);
          setMode('window');
        }
      }
      setScopeDate(null);
    }
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
    if (!calPresent || calExiting) return;
    const onDoc = (e: MouseEvent) => {
      if (calWrapRef.current && !calWrapRef.current.contains(e.target as Node)) {
        closeCalendar();
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [calPresent, calExiting, closeCalendar]);

  if (!panelPresent) return null;

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

  const seedWindow = (dict: ScheduleLayerDict = layers) => {
    if (dict.main) {
      return { startMin: dict.main.startMin, endMin: dict.main.endMin, mode: dict.main.mode as ScopeMode };
    }
    return { startMin: 6 * 60, endMin: DAY_MIN + 60, mode: 'window' as ScopeMode };
  };

  /** [Все]: click active → снять main; иначе создать/выбрать. */
  const toggleMain = () => {
    if (readOnly) return;
    setScopeDate(null);
    if (layers.main && scopeMain && !onDateScope) {
      rememberLayer(layers.main.id, memFromLayer({ mode, startMin, endMin }));
      setLayers((prev) => ({ ...prev, main: null }));
      setScopeMain(false);
      setWeekdays(new Set());
      return;
    }
    if (layers.main) {
      setScopeMain(true);
      loadEditorFromLayer(layers.main);
      return;
    }
    const remembered = recallLayer(layerIdMain());
    const seed = seedWindow();
    const main = defaultMainLayer(
      remembered?.startMin ?? seed.startMin,
      remembered?.endMin ?? seed.endMin,
    );
    main.mode = remembered?.mode ?? seed.mode;
    setLayers((prev) => ({ ...prev, main }));
    setScopeMain(true);
    loadEditorFromLayer(main);
  };

  /** [Будни]/[Сб,Вс]: XOR; повторный клик по выбранной → снять группу. */
  const toggleGroup = (days: number[]) => {
    if (readOnly) return;
    setScopeDate(null);
    const mask = maskFromDays(new Set(days));
    const id = layerIdDow(mask);
    const existing = findLayer(layers, false, new Set(days));
    const editingThis =
      !scopeMain && !onDateScope && weekdays.size === days.length && days.every((d) => weekdays.has(d));

    if (existing && editingThis) {
      rememberLayer(existing.id, memFromLayer({ mode, startMin, endMin }));
      setLayers((prev) => removeExcById(prev, existing.id));
      setScopeMain(false);
      setWeekdays(new Set());
      return;
    }

    const seed = seedWindow();
    const remembered = !existing ? recallLayer(id) : undefined;
    let start = seed.startMin;
    let end = seed.endMin;
    let layerMode = seed.mode;
    if (existing) {
      start = existing.startMin;
      end = existing.endMin;
      layerMode = existing.mode;
    } else if (remembered) {
      start = remembered.startMin;
      end = remembered.endMin;
      layerMode = remembered.mode;
    } else if (activeTpl && shiftHours != null) {
      const w = pickWindow(presets[activeTpl.id], dayTypeOf(new Set(days)));
      const axis = w
        ? templateToAxisMins(w.openH, w.openM, w.closeH, w.closeM, shiftHours)
        : null;
      if (axis) {
        start = axis.startMin;
        end = axis.endMin;
      }
    }

    const layer: ScheduleLayer = {
      id,
      scopeKind: 'dow',
      dowMask: mask,
      dateFrom: null,
      dateTo: null,
      label: labelFromMask(mask),
      mode: layerMode,
      startMin: start,
      endMin: end,
    };
    rememberLayer(id, memFromLayer(layer));
    setLayers((prev) => promoteExc(prev, layer));
    setScopeMain(false);
    setWeekdays(new Set(days));
    loadEditorFromLayer(layer);
  };

  /** [Пн]…[Вс]: single; Ctrl/Cmd — multi-select для солидарных маркеров. */
  const toggleSingleDay = (dow: number, additive = false) => {
    if (readOnly) return;
    setScopeDate(null);

    if (additive) {
      const inMulti =
        !scopeMain && !onDateScope && weekdays.size >= 1 && !isGroupMask(maskFromDays(weekdays));
      const next = new Set(inMulti ? weekdays : []);
      if (next.has(dow)) {
        if (next.size <= 1) return; // последний выбранный не снимаем Ctrl'ом
        next.delete(dow);
        setScopeMain(false);
        setWeekdays(next);
        return;
      }
      next.add(dow);
      const mask = maskFromDays(new Set([dow]));
      const id = layerIdDow(mask);
      const existing = findSingleDayExc(layers, dow);
      // Солидарность маркеров: новые/добавленные дни получают текущее окно редактора.
      if (!existing) {
        const layer: ScheduleLayer = {
          id,
          scopeKind: 'dow',
          dowMask: mask,
          dateFrom: null,
          dateTo: null,
          label: labelFromMask(mask),
          mode,
          startMin,
          endMin,
        };
        rememberLayer(id, memFromLayer(layer));
        setLayers((prev) => promoteExc(prev, layer));
      } else {
        setLayers((prev) =>
          patchActiveLayer(
            prev,
            { kind: 'dow', days: new Set([dow]) },
            { mode, startMin, endMin },
          ),
        );
      }
      setScopeMain(false);
      setWeekdays(next);
      if (!inMulti) loadEditorFromLayer({
        id,
        scopeKind: 'dow',
        dowMask: mask,
        dateFrom: null,
        dateTo: null,
        label: labelFromMask(mask),
        mode,
        startMin,
        endMin,
      });
      return;
    }

    const mask = maskFromDays(new Set([dow]));
    const id = layerIdDow(mask);
    const existing = findSingleDayExc(layers, dow);
    const editingThis =
      !scopeMain && !onDateScope && weekdays.size === 1 && weekdays.has(dow);

    if (existing && editingThis) {
      rememberLayer(existing.id, memFromLayer({ mode, startMin, endMin }));
      setLayers((prev) => removeExcById(prev, existing.id));
      setScopeMain(false);
      setWeekdays(new Set());
      return;
    }

    const seed = seedWindow();
    const remembered = !existing ? recallLayer(id) : undefined;
    let start = seed.startMin;
    let end = seed.endMin;
    let layerMode = seed.mode;
    if (existing) {
      start = existing.startMin;
      end = existing.endMin;
      layerMode = existing.mode;
    } else if (remembered) {
      start = remembered.startMin;
      end = remembered.endMin;
      layerMode = remembered.mode;
    } else if (activeTpl && shiftHours != null) {
      const dt: DayType = dow === 0 || dow === 6 ? 'weekend' : 'weekday';
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
      id,
      scopeKind: 'dow',
      dowMask: mask,
      dateFrom: null,
      dateTo: null,
      label: labelFromMask(mask),
      mode: layerMode,
      startMin: start,
      endMin: end,
    };
    rememberLayer(id, memFromLayer(layer));
    setLayers((prev) => promoteExc(prev, layer));
    setScopeMain(false);
    setWeekdays(new Set([dow]));
    loadEditorFromLayer(layer);
  };

  const chooseDateScope = (from: string, to: string, opts?: { create?: boolean }) => {
    if (readOnly) return;
    closeCalendar();
    setScopeMain(false);
    setScopeDate({ from, to });

    const id = layerIdDate(from, to);
    const existing = findDateLayer(layers, from, to);
    const isCreate = opts?.create ?? existing == null;
    const seed = seedWindow();
    const remembered = isCreate ? recallLayer(id) : undefined;

    let start = seed.startMin;
    let end = seed.endMin;
    let layerMode: ScopeMode = seed.mode;

    if (existing && !isCreate) {
      start = existing.startMin;
      end = existing.endMin;
      layerMode = existing.mode;
    } else if (remembered) {
      start = remembered.startMin;
      end = remembered.endMin;
      layerMode = remembered.mode;
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
    } else if (existing) {
      start = existing.startMin;
      end = existing.endMin;
      layerMode = existing.mode;
    }

    const layer: ScheduleLayer = {
      id,
      scopeKind: 'date',
      dowMask: null,
      dateFrom: from,
      dateTo: to,
      label: labelFromDateRange(from, to),
      mode: layerMode,
      startMin: start,
      endMin: end,
    };

    const nextDict = isCreate ? createStaticExc(layers, layer) : layers;
    if (isCreate) {
      rememberLayer(id, memFromLayer(layer));
      setLayers(nextDict);
    }
    loadEditorFromLayer(isCreate ? layer : (existing ?? layer));

    const union = unionStaticComponentRange(nextDict.staticExc, from, to);
    const single = union.from === union.to;
    const chartFrom = single ? addDaysIso(union.from, -CHART_PAD_DAYS) : union.from;
    const chartTo = single ? addDaysIso(union.to, CHART_PAD_DAYS) : union.to;
    loadCalendarRange(chartFrom, chartTo);
  };

  const clearExceptions = () => {
    if (readOnly) return;
    closeCalendar();
    setScopeDate(null);
    for (const e of layers.exc) rememberLayer(e.id, memFromLayer(e));
    for (const e of layers.staticExc) rememberLayer(e.id, memFromLayer(e));
    setLayers((prev) => ({ main: prev.main, exc: [], staticExc: [] }));
    if (layers.main) {
      setScopeMain(true);
      loadEditorFromLayer(layers.main);
    } else {
      setScopeMain(false);
      setWeekdays(new Set());
    }
  };

  const clearStaticExceptions = () => {
    if (readOnly) return;
    for (const e of layers.staticExc) rememberLayer(e.id, memFromLayer(e));
    setLayers((prev) => ({ ...prev, staticExc: [] }));
    if (scopeDate) {
      setScopeDate(null);
      if (layers.main) {
        setScopeMain(true);
        loadEditorFromLayer(layers.main);
      } else {
        setScopeMain(false);
        setWeekdays(new Set());
      }
    }
  };

  const hasActiveLayer =
    scopeMain ? layers.main != null : onDateScope ? true : weekdays.size > 0;

  const setWindow = (s: number, e: number) => {
    if (!hasActiveLayer) return;
    const start = Math.max(OPEN_LO, Math.min(s, DAY_MIN - 5));
    let end = Math.max(start + 5, e);
    end = Math.min(end, start + MAX_SPAN_MIN, HORIZON_HI);
    setStartMin(start);
    setEndMin(end);
    const mem: LayerMemory = { mode: 'window', startMin: start, endMin: end };
    if (activeScope.kind === 'main') rememberLayer(layerIdMain(), mem);
    else if (activeScope.kind === 'dow') {
      const m = maskFromDays(activeScope.days);
      if (activeScope.days.size > 1 && !isGroupMask(m)) {
        for (const d of activeScope.days) rememberLayer(layerIdDow(maskFromDays(new Set([d]))), mem);
      } else {
        rememberLayer(layerIdDow(m), mem);
      }
    } else rememberLayer(layerIdDate(activeScope.from, activeScope.to), mem);
    setLayers((prev) =>
      patchActiveLayer(prev, activeScope, { startMin: start, endMin: end, mode: 'window' }),
    );
  };

  const setScopeMode = (m: ScopeMode) => {
    if (!hasActiveLayer) return;
    setMode(m);
    const mem: LayerMemory = { mode: m, startMin, endMin };
    if (activeScope.kind === 'main') rememberLayer(layerIdMain(), mem);
    else if (activeScope.kind === 'dow') {
      const mask = maskFromDays(activeScope.days);
      if (activeScope.days.size > 1 && !isGroupMask(mask)) {
        for (const d of activeScope.days) rememberLayer(layerIdDow(maskFromDays(new Set([d]))), mem);
      } else {
        rememberLayer(layerIdDow(mask), mem);
      }
    } else rememberLayer(layerIdDate(activeScope.from, activeScope.to), mem);
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
        const union = unionStaticComponentRange(layers.staticExc, scopeDate.from, scopeDate.to);
        const single = union.from === union.to;
        const from = single ? addDaysIso(union.from, -CHART_PAD_DAYS) : union.from;
        const to = single ? addDaysIso(union.to, CHART_PAD_DAYS) : union.to;
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
            labelTip: `${dowLabelFromIso(iso)} ${fmtDdMm(iso)}.${iso.slice(0, 4)}`,
            seg: {
              mode: w?.mode ?? 'window',
              startMin: w?.startMin ?? 0,
              endMin: w?.endMin ?? 0,
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
        const active = scopeMain ? layers.main != null : weekdays.has(js);
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
            mode: w?.mode ?? 'window',
            startMin: w?.startMin ?? 0,
            endMin: w?.endMin ?? 0,
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
    if (readOnly || !hasActiveLayer) return;
    if (scopeKind === 'main' && !layers.main) return;
    if (scopeKind === 'dow' && dowMask === 0) return;
    if (scopeKind === 'date' && !scopeDate) return;
    const scopeText =
      scopeKind === 'main'
        ? 'основное'
        : scopeKind === 'date' && scopeDate
          ? labelFromDateRange(scopeDate.from, scopeDate.to)
          : WEEKDAYS.filter((w) => weekdays.has(w.dow)).map((w) => w.label).join(',');
    if (!window.confirm(`Утвердить правило «${scopeText}»?`)) return;

    const multiSingles =
      scopeKind === 'dow' && weekdays.size > 1 && !isGroupMask(dowMask);

    const makeBody = (mask: number | null): PutConnectionScheduleRuleRequest =>
      mode === 'off'
        ? {
            scopeKind,
            dowMask: scopeKind === 'dow' ? mask : null,
            dateFrom: scopeKind === 'date' && scopeDate ? scopeDate.from : null,
            dateTo: scopeKind === 'date' && scopeDate ? scopeDate.to : null,
            mode: 'off',
            changeSource: 'ui',
            changeNote: note.trim() || null,
          }
        : {
            scopeKind,
            dowMask: scopeKind === 'dow' ? mask : null,
            dateFrom: scopeKind === 'date' && scopeDate ? scopeDate.from : null,
            dateTo: scopeKind === 'date' && scopeDate ? scopeDate.to : null,
            mode: 'window',
            open: `${openHm}:00`,
            durationMin,
            changeSource: 'ui',
            changeNote: note.trim() || null,
          };

    if (multiSingles) {
      for (const d of weekdays) {
        onUpsertRule(makeBody(maskFromDays(new Set([d]))));
      }
    } else {
      onUpsertRule(makeBody(scopeKind === 'dow' ? dowMask : null));
    }
    onClose();
  };

  return (
    <div
      className={[styles.backdrop, panelExiting ? styles.backdropOut : ''].filter(Boolean).join(' ')}
      onClick={onClose}
      role="presentation"
    >
      <div
        className={[
          styles.panel,
          panelExiting ? styles.panelOut : '',
          calPresent ? styles.panelCalFocus : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Расписание соединения"
      >
        {calPresent && (
          <div
            className={[styles.calScrim, calExiting ? styles.calScrimOut : ''].filter(Boolean).join(' ')}
            onClick={closeCalendar}
            aria-hidden="true"
          />
        )}
        <header className={styles.head}>
          <strong>Расписание соединения</strong>
          <div className={styles.headActions}>
            <Tip content={editing ? 'Режим редактирования' : 'Режим просмотра'}>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setEditing((v) => !v)}
                aria-pressed={editing}
              >
                {editing ? <PencilIcon className={styles.headIcon} /> : <EyeIcon className={styles.headIcon} />}
              </button>
            </Tip>
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
          readOnly={readOnly || mode === 'off' || !hasActiveLayer}
          off={mode === 'off'}
          baseStartMin={baseAxis?.startMin ?? null}
          baseEndMin={baseAxis?.endMin ?? null}
          durationLabel={durationLabel}
          onChange={onWindowChange}
        />

        <div className={[styles.section, readOnly ? styles.sectionLocked : ''].filter(Boolean).join(' ')}>
          <span className={styles.sectionTitle}>Область правила</span>
          <div className={styles.chips}>
            <Tip content="Основное расписание (можно снять)">
              <button
                type="button"
                className={[
                  styles.chip,
                  layers.main && scopeMain && !onDateScope ? styles.chipOn : '',
                  layers.main && !(scopeMain && !onDateScope) ? styles.chipHas : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={readOnly}
                onClick={toggleMain}
              >
                Все
              </button>
            </Tip>
            <Tip content="Сбросить все исключения (periodical + static)">
              <button
                type="button"
                className={styles.chip}
                disabled={readOnly || !hasAnyExc}
                onClick={clearExceptions}
              >
                Очистить
              </button>
            </Tip>
          </div>
          <div className={styles.chips}>
            <Tip content="Регулярное исключение · группа будни (XOR с выходными)">
              <button
                type="button"
                className={[
                  styles.chip,
                  !scopeMain && !onDateScope && sameDays(weekdays, WEEKDAY_DAYS) ? styles.chipOn : '',
                  findLayer(layers, false, new Set(WEEKDAY_DAYS)) &&
                  !(!scopeMain && !onDateScope && sameDays(weekdays, WEEKDAY_DAYS))
                    ? styles.chipHas
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={readOnly}
                onClick={() => toggleGroup(WEEKDAY_DAYS)}
              >
                Будни
              </button>
            </Tip>
            <Tip content="Регулярное исключение · группа Сб+Вс (XOR с буднями)">
              <button
                type="button"
                className={[
                  styles.chip,
                  !scopeMain && !onDateScope && sameDays(weekdays, WEEKEND_DAYS) ? styles.chipOn : '',
                  findLayer(layers, false, new Set(WEEKEND_DAYS)) &&
                  !(!scopeMain && !onDateScope && sameDays(weekdays, WEEKEND_DAYS))
                    ? styles.chipHas
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={readOnly}
                onClick={() => toggleGroup(WEEKEND_DAYS)}
              >
                Сб, Вс
              </button>
            </Tip>
            <div
              className={[styles.calWrap, calPresent ? styles.calWrapOpen : ''].filter(Boolean).join(' ')}
              ref={calWrapRef}
            >
              <Tip content="Одиночное исключение (по датам)">
                <button
                  type="button"
                  className={[styles.chip, onDateScope || calPresent ? styles.chipOn : ''].filter(Boolean).join(' ')}
                  disabled={readOnly}
                  aria-expanded={calOpen}
                  onClick={(e) => {
                    if (calOpen) closeCalendar();
                    else openCalendar();
                    // Убрать :focus-visible — иначе chipOn + outline = двойная рамка.
                    e.currentTarget.blur();
                  }}
                >
                  <CalendarIcon className={styles.chipIcon} />
                  Календарь
                </button>
              </Tip>
              {calPresent && (
                <div className={[styles.calPop, calExiting ? styles.calPopOut : ''].filter(Boolean).join(' ')}>
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
                    onDismiss={closeCalendar}
                  />
                </div>
              )}
            </div>
          </div>
          <div className={styles.days}>
            {WEEKDAYS.map((w) => {
              const hasSingle = findSingleDayExc(layers, w.dow) != null;
              const editingDay =
                !scopeMain && !onDateScope && weekdays.has(w.dow) && !isGroupMask(maskFromDays(weekdays));
              return (
                <Tip key={w.dow} content="Регулярное исключение (день). Ctrl — несколько дней" block>
                  <button
                    type="button"
                    className={[
                      styles.day,
                      editingDay ? styles.dayOn : '',
                      hasSingle && !editingDay ? styles.dayHas : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    disabled={readOnly}
                    onClick={(e) => toggleSingleDay(w.dow, e.ctrlKey || e.metaKey)}
                  >
                    {w.label}
                  </button>
                </Tip>
              );
            })}
          </div>
          {onDateScope && scopeDate && (
            <span className={styles.meta}>
              Static · {labelFromDateRange(scopeDate.from, scopeDate.to)}
            </span>
          )}
        </div>

        <div className={[styles.section, readOnly || !hasActiveLayer ? styles.sectionLocked : ''].filter(Boolean).join(' ')}>
          <span className={styles.sectionTitle}>Режим</span>
          <div className={styles.chips}>
            <Tip content="On/Off по расписанию">
              <button
                type="button"
                className={[styles.chip, mode === 'window' ? styles.chipOn : ''].filter(Boolean).join(' ')}
                disabled={readOnly || !hasActiveLayer}
                onClick={() => setScopeMode('window')}
              >
                Окно связи
              </button>
            </Tip>
            <Tip content="Off-интервал (не подключаться)">
              <button
                type="button"
                className={[styles.chip, mode === 'off' ? styles.chipOn : ''].filter(Boolean).join(' ')}
                disabled={readOnly || !hasActiveLayer}
                onClick={() => setScopeMode('off')}
              >
                Выключено
              </button>
            </Tip>
          </div>
        </div>

        <div
          className={[styles.section, readOnly || mode === 'off' || !hasActiveLayer ? styles.sectionLocked : '']
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
                  disabled={readOnly || mode === 'off' || !hasActiveLayer || !canApply}
                  onClick={() => applyTemplate(tpl, shiftHours)}
                >
                  {tpl.label}
                </button>
              );
            })}
            <span className={styles.divider} />
            {SHIFTS.map((n) => (
              <Tip
                key={n}
                content={
                  isShiftValid(activeWin, n)
                    ? `Shift ±${n} ч к диапазону`
                    : 'Shift недоступен: open уйдёт во вчера, или duration >24ч'
                }
              >
                <button
                  type="button"
                  className={[styles.chip, shiftHours === n ? styles.chipOn : ''].filter(Boolean).join(' ')}
                  disabled={readOnly || mode === 'off' || !hasActiveLayer || !isShiftValid(activeWin, n)}
                  onClick={() => selectShift(n)}
                >
                  {n === 0 ? 'Shift 0' : String(n)}
                </button>
              </Tip>
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

        {!onDateScope && (
          <div className={styles.regularBoard} aria-label="Слои periodical по дням">
            {WEEKDAYS.map((w) => {
              const slots = regularBoardSlots(layers, w.dow);
              const ribbonBg = (slot: (typeof slots)[number]) => {
                if (slot.kind === 'main') {
                  if (!slot.layer) return undefined;
                  if (slot.layer.mode === 'off') return '#e05555';
                  return layerTone(2);
                }
                if (slot.layer.mode === 'off') return '#e05555';
                if (slot.kind === 'group') return layerTone(0);
                return layerTone(1);
              };
              return (
                <div key={w.dow} className={styles.regularCol}>
                  <div className={styles.regularRibbons}>
                    {slots.map((slot, i) => (
                      <span
                        key={`${slot.kind}-${i}`}
                        className={[
                          styles.regularRibbon,
                          slot.kind === 'main' && !slot.layer ? styles.regularRibbonUnset : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        style={
                          slot.kind === 'main' && !slot.layer
                            ? undefined
                            : { background: ribbonBg(slot) }
                        }
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Tip content={readOnly ? 'Переключитесь в режим редактирования' : !hasActiveLayer ? 'Выберите слой' : undefined} block>
          <button
            type="button"
            className={styles.approve}
            onClick={approve}
            disabled={readOnly || !hasActiveLayer}
          >
            Утвердить
          </button>
        </Tip>

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
