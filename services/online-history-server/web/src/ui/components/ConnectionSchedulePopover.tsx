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
  assignStaticBoardLevels,
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
  layersBottomToTop,
  maskFromDays,
  normalizeRegularExc,
  promoteExc,
  regularBoardSlots,
  removeExcById,
  resolveLayerForDate,
  resolveLayerForDow,
  staticBoardSlots,
  unionStaticComponentRange,
  type ScheduleLayer,
  type ScheduleLayerDict,
} from '../../core/scheduleLayerDict';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { ConfirmDialog, type MessageBoxSeverity } from './ConfirmDialog';
import { CalendarIcon, EyeIcon, PencilIcon } from './icons';
import { layerTone, staticPreviewTone, StaticExceptionCalendar } from './StaticExceptionCalendar';
import {
  DAY_MIN,
  HORIZON_HI,
  MAX_SPAN_MIN,
  OPEN_LO,
  ScheduleWindowRibbon,
  templateToAxisMins,
} from './ScheduleWindowRibbon';
import { WeeklyDayColumns, type DayColumn } from './WeeklyDayColumns';
import styles from './ConnectionSchedulePopover.module.css';

/** Локальный message box поверх модалки расписания. */
type ScheduleMsgBox = {
  severity: MessageBoxSeverity;
  title: string;
  message: string;
  /** Если задан — confirm (ОК + Отмена); иначе alert (только ОК). */
  onConfirm?: () => void;
};

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

/** Подпись даты под DOW: при >14 колонках только число дня. */
function fmtChartDatePart(iso: string, colCount: number): string {
  if (colCount > 14) return String(Number(iso.slice(8, 10)));
  return fmtDdMm(iso);
}

/** Объединение dateFrom/dateTo по всем static-слоям словарей. */
function unionAllStaticRanges(...dicts: ScheduleLayerDict[]): { from: string; to: string } | null {
  let from: string | null = null;
  let to: string | null = null;
  for (const dict of dicts) {
    for (const e of dict.staticExc) {
      if (!e.dateFrom || !e.dateTo) continue;
      if (from == null || e.dateFrom < from) from = e.dateFrom;
      if (to == null || e.dateTo > to) to = e.dateTo;
    }
  }
  return from && to ? { from, to } : null;
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

/** Стабильный id слоя для правила base (совпадает с layerId* в scheduleLayerDict). */
function ruleLayerId(rule: ConnectionScheduleRuleDto): string | null {
  if (rule.scopeKind === 'main') return layerIdMain();
  if (rule.scopeKind === 'dow') return rule.dowMask != null && rule.dowMask > 0 ? layerIdDow(rule.dowMask) : null;
  if (rule.scopeKind === 'date') return rule.dateFrom && rule.dateTo ? layerIdDate(rule.dateFrom, rule.dateTo) : null;
  return null;
}

/** Отличается ли черновой слой от base-слоя того же id (для отбора реальных изменений). */
function layerDiffers(a: ScheduleLayer, b: ScheduleLayer): boolean {
  if (a.mode !== b.mode) return true;
  if (a.mode === 'off') return false; // окно нерелевантно
  return a.startMin !== b.startMin || a.endMin !== b.endMin;
}

/** Слой черновика → тело PUT (open+durationMin из абсолютных минут оси). */
function layerToPutBody(layer: ScheduleLayer, changeNote: string | null): PutConnectionScheduleRuleRequest {
  const base = {
    scopeKind: layer.scopeKind,
    dowMask: layer.scopeKind === 'dow' ? layer.dowMask : null,
    dateFrom: layer.scopeKind === 'date' ? layer.dateFrom : null,
    dateTo: layer.scopeKind === 'date' ? layer.dateTo : null,
    changeSource: 'ui',
    changeNote,
  };
  if (layer.mode === 'off') {
    return { ...base, mode: 'off' };
  }
  const openMin = ((layer.startMin % 1440) + 1440) % 1440;
  const durationMin = Math.min(Math.max(layer.endMin - layer.startMin, 1), 1439);
  const open = `${String(Math.floor(openMin / 60)).padStart(2, '0')}:${String(openMin % 60).padStart(2, '0')}:00`;
  return { ...base, mode: 'window', open, durationMin };
}

/** Интервал окна на оси 48h; off/пусто → null. */
interface Iv {
  s: number;
  e: number;
}
function layerToIv(layer: ScheduleLayer | null): Iv | null {
  if (!layer || layer.mode !== 'window' || layer.endMin <= layer.startMin) return null;
  return { s: layer.startMin, e: layer.endMin };
}
/** Куски a, не покрытые b (разность множеств по времени). */
function subtractIv(a: Iv | null, b: Iv | null): Iv[] {
  if (!a) return [];
  if (!b) return [a];
  const out: Iv[] = [];
  if (b.s > a.s) out.push({ s: a.s, e: Math.min(b.s, a.e) });
  if (b.e < a.e) out.push({ s: Math.max(b.e, a.s), e: a.e });
  return out.filter((iv) => iv.e > iv.s);
}
function intersectIv(a: Iv | null, b: Iv | null): Iv[] {
  if (!a || !b) return [];
  const s = Math.max(a.s, b.s);
  const e = Math.min(a.e, b.e);
  return e > s ? [{ s, e }] : [];
}

type DiffKind = 'added' | 'removed' | 'modified';
interface DiffEntry {
  id: string;
  label: string;
  kind: DiffKind;
  before: ScheduleLayer | null;
  after: ScheduleLayer | null;
}

/** Полоски слева у строки правила (confirm).
 * main/regular: blue = было, light = стало/добавили; red = отмена.
 * static: yellow вместо light. */
type DiffStripe = 'blue' | 'light' | 'red' | 'yellow';

function diffStripes(e: DiffEntry): DiffStripe[] {
  const isStatic = diffScopeKind(e) === 'static';
  if (e.kind === 'modified') return [isStatic ? 'yellow' : 'light'];
  if (e.kind === 'removed') return ['red'];
  // Добавлена отмена (off): было + красная.
  if (e.after?.mode === 'off') return ['blue', 'red'];
  // Добавлено окно: было + светлая (static → желтоватая).
  return ['blue', isStatic ? 'yellow' : 'light'];
}

function diffTag(e: DiffEntry): string {
  if (e.kind === 'added') return 'добавлено';
  if (e.kind === 'removed') return 'отменено';
  return 'изменено';
}

/** main / dow(regular) / date(static) — для лёгкой маски фона. */
function diffScopeKind(e: DiffEntry): 'main' | 'regular' | 'static' {
  const layer = e.after ?? e.before;
  if (layer?.scopeKind === 'date') return 'static';
  if (layer?.scopeKind === 'dow') return 'regular';
  return 'main';
}

const DIFF_STRIPE_CLASS: Record<DiffStripe, string> = {
  blue: styles.stripe_blue,
  light: styles.stripe_light,
  red: styles.stripe_red,
  yellow: styles.stripe_yellow,
};

const DIFF_SCOPE_BG: Record<'main' | 'regular' | 'static', string> = {
  main: styles.diffRow_main,
  regular: styles.diffRow_regular,
  static: styles.diffRow_static,
};

/** Дифф base-словаря против чернового: added/modified/removed по каждому слою. */
function computeDiffEntries(base: ScheduleLayerDict, cur: ScheduleLayerDict): DiffEntry[] {
  const baseArr = layersBottomToTop(base);
  const curArr = layersBottomToTop(cur);
  const baseById = new Map(baseArr.map((l) => [l.id, l]));
  const curIds = new Set(curArr.map((l) => l.id));
  const out: DiffEntry[] = [];
  for (const l of curArr) {
    const b = baseById.get(l.id);
    if (!b) out.push({ id: l.id, label: scopeLabel(l), kind: 'added', before: null, after: l });
    else if (layerDiffers(l, b)) out.push({ id: l.id, label: scopeLabel(l), kind: 'modified', before: b, after: l });
  }
  for (const b of baseArr) {
    if (!curIds.has(b.id)) out.push({ id: b.id, label: scopeLabel(b), kind: 'removed', before: b, after: null });
  }
  return out;
}

function scopeLabel(l: ScheduleLayer): string {
  return l.scopeKind === 'main' ? 'Основное' : l.label;
}

/** Источник изменения → человекочитаемо. */
function sourceLabel(source: string | null | undefined): string {
  if (source === 'ui') return 'оператор';
  if (source === 'system') return 'система';
  if (source === 'schedule') return 'расписание';
  return source ?? '—';
}

/** Окно слоя текстом: HH:MM–HH:MM | «выкл» | «—». */
function winText(l: ScheduleLayer | null): string {
  if (!l) return '—';
  if (l.mode === 'off') return 'выкл';
  return `${fmtMin(l.startMin)}–${fmtMin(l.endMin)}`;
}

/** Дельта длительности окна (для modified): «+1ч 30м» / «−45м». */
function durDeltaText(before: ScheduleLayer | null, after: ScheduleLayer | null): string {
  if (!before || !after || before.mode !== 'window' || after.mode !== 'window') return '';
  const d = after.endMin - after.startMin - (before.endMin - before.startMin);
  if (d === 0) return '';
  const sign = d > 0 ? '+' : '−';
  const abs = Math.abs(d);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return ` (${sign}${h ? `${h}ч ` : ''}${m}м)`;
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
  const [, setEngine] = useState('futures');
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
  /** Шаг мастера: редактирование ↔ подтверждение (diff-превью). */
  const [view, setView] = useState<'edit' | 'confirm'>('edit');
  /** Обзор всех слоёв (агрегация): маркеры только смотрим. */
  const [aggregateView, setAggregateView] = useState(false);
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
  /** Анимация входа edit только при возврате с confirm (не при первом открытии). */
  const [editStepIn, setEditStepIn] = useState(false);
  /** Toggle-группа MOEX на confirm (null = все выкл.). */
  const [confirmTemplate, setConfirmTemplate] = useState<TemplateId | null>(null);
  /** Toggle «Календарь» на confirm (пока только UI). */
  const [confirmCalOn, setConfirmCalOn] = useState(false);
  /** Аккордеоны групп правил на confirm (≥2 regular/static). */
  const [regularOpen, setRegularOpen] = useState(true);
  const [staticOpen, setStaticOpen] = useState(false);
  const calWrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** Память last-known окна слоя на сессию поповера (снял → вернул). */
  const layerMemRef = useRef<Map<string, LayerMemory>>(new Map());
  /** Снимок base (живые правила с бэка) на сессию edit — для диффа при «Утвердить». */
  const baseDictRef = useRef<ScheduleLayerDict>(emptyLayerDict());
  /** id слоя base → scheduleId (для soft-cancel снятых при утверждении). */
  const baseSchedIdRef = useRef<Map<string, number>>(new Map());
  const [msgBox, setMsgBox] = useState<ScheduleMsgBox | null>(null);
  /**
   * Click-out → сохранить черновик до следующего открытия.
   * × / commit → сбросить (осознанный выход).
   */
  const preserveDraftRef = useRef(false);

  const softClose = useCallback(() => {
    preserveDraftRef.current = true;
    onClose();
  }, [onClose]);

  const hardClose = useCallback(() => {
    preserveDraftRef.current = false;
    onClose();
  }, [onClose]);

  /** Зафиксировать размер панели (edit → confirm без прыжка высоты). */
  const lockPanelSize = useCallback(() => {
    const el = panelRef.current;
    if (!el) return;
    const h = Math.ceil(el.getBoundingClientRect().height);
    el.style.minHeight = `${h}px`;
    el.style.height = `${h}px`;
  }, []);

  const unlockPanelSize = useCallback(() => {
    const el = panelRef.current;
    if (!el) return;
    el.style.minHeight = '';
    el.style.height = '';
  }, []);

  /** Confirm → edit: разблокировать высоту и включить анимацию входа. */
  const goToEdit = useCallback(() => {
    unlockPanelSize();
    setEditStepIn(true);
    setView('edit');
  }, [unlockPanelSize]);

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
      unlockPanelSize();
      setPanelPresent(false);
      setPanelExiting(false);
      closeCalendarInstant();
    }, closeMs());
    return () => window.clearTimeout(t);
  }, [panelExiting, closeCalendarInstant, unlockPanelSize]);

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

  /** Confirm · Календарь: подтянуть nonTrading для диапазона static. */
  useEffect(() => {
    if (view !== 'confirm' || !confirmCalOn) return;
    const span = unionAllStaticRanges(layers, baseDictRef.current);
    if (!span) {
      setConfirmCalOn(false);
      return;
    }
    const single = span.from === span.to;
    const from = single ? addDaysIso(span.from, -CHART_PAD_DAYS) : span.from;
    const to = single ? addDaysIso(span.to, CHART_PAD_DAYS) : span.to;
    loadCalendarRange(from, to);
  }, [view, confirmCalOn, layers, loadCalendarRange]);

  /** Confirm · аккордеоны: cal on → static↑ regular↓; cal off → наоборот. */
  useEffect(() => {
    if (view !== 'confirm') return;
    setRegularOpen(!confirmCalOn);
    setStaticOpen(confirmCalOn);
  }, [view, confirmCalOn]);

  useEffect(() => {
    if (!open) return;

    // Click-out: вернуть тот же черновик (слои, confirm, скоуп…).
    if (preserveDraftRef.current) {
      preserveDraftRef.current = false;
      closeCalendarInstant();
      OhsApi.getConnectionScheduleHistory(connectionId).subscribe({
        next: setHistory,
        error: () => setHistory([]),
      });
      return;
    }

    setMode('window');
    setShiftHours(1);
    setNote('');
    closeCalendarInstant();
    setCalDays(new Map());
    setEditing(rules.length === 0);
    setView('edit');
    setEditStepIn(false);
    setConfirmTemplate(null);
    setConfirmCalOn(false);
    setRegularOpen(true);
    setStaticOpen(false);
    setAggregateView(rules.length > 0);

    const dict = rules.length > 0 ? dictFromRules(rules) : emptyLayerDict();
    setLayers(dict);
    seedLayerMemory(layerMemRef.current, dict);
    // Снимок base для диффа при утверждении (immutable в этой сессии edit).
    baseDictRef.current = dict;
    const schedIds = new Map<string, number>();
    for (const r of rules) {
      const id = ruleLayerId(r);
      if (id) schedIds.set(id, r.scheduleId);
    }
    baseSchedIdRef.current = schedIds;
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
  }, [open, connectionId, rules, state, closeCalendarInstant]);

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

  /** Eye + Календарь: nonTrading на полный static-span (как confirm). */
  useEffect(() => {
    if (editing || !scopeDate) return;
    const span =
      unionAllStaticRanges(layers, baseDictRef.current) ?? {
        from: scopeDate.from,
        to: scopeDate.to,
      };
    const single = span.from === span.to;
    const from = single ? addDaysIso(span.from, -CHART_PAD_DAYS) : span.from;
    const to = single ? addDaysIso(span.to, CHART_PAD_DAYS) : span.to;
    loadCalendarRange(from, to);
  }, [editing, scopeDate, layers, loadCalendarRange]);

  if (!panelPresent) return null;

  const readOnly = !editing;
  /** View (Eye) всегда в агрегате; в Edit — чип «Просмотр». */
  const showAggregate = !editing || aggregateView;
  const markersLocked = readOnly || showAggregate || mode === 'off';
  const dowMask = maskFromDays(weekdays);
  const onDateScope = scopeDate != null;
  const activeScope: ActiveScope = scopeMain
    ? { kind: 'main' }
    : onDateScope
      ? { kind: 'date', from: scopeDate.from, to: scopeDate.to }
      : { kind: 'dow', days: weekdays };
  const hasAnyExc = layers.exc.length > 0 || layers.staticExc.length > 0;
  const hasAnyLayers = layers.main != null || hasAnyExc;
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

  /** Выбрать слой для редактирования (клик по колбаске / чипу). */
  const selectLayer = (layer: ScheduleLayer) => {
    setAggregateView(false);
    if (layer.scopeKind === 'main') {
      setScopeDate(null);
      setScopeMain(true);
      loadEditorFromLayer(layer);
      return;
    }
    if (layer.scopeKind === 'date' && layer.dateFrom && layer.dateTo) {
      setScopeMain(false);
      setScopeDate({ from: layer.dateFrom, to: layer.dateTo });
      loadEditorFromLayer(layer);
      return;
    }
    if (layer.dowMask != null) {
      setScopeDate(null);
      setScopeMain(false);
      setWeekdays(new Set(daysFromMask(layer.dowMask)));
      loadEditorFromLayer(layer);
    }
  };

  const onChartSegClick = (key: string) => {
    if (readOnly) return;
    if (onDateScope) {
      const w = resolveLayerForDate(layers, key);
      if (w) selectLayer(w);
      return;
    }
    const js = Number(key);
    if (!Number.isFinite(js)) return;
    const w = resolveLayerForDow(layers, js);
    if (w) selectLayer(w);
  };

  /** [Все]: click active → снять main; иначе создать/выбрать. */
  const toggleMain = () => {
    if (readOnly) return;
    setAggregateView(false);
    setScopeDate(null);
    if (layers.main && scopeMain && !onDateScope && !showAggregate) {
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
    setAggregateView(false);
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
    setAggregateView(false);
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
    setAggregateView(false);
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

  const clearAllChanges = () => {
    if (readOnly) return;
    setAggregateView(false);
    closeCalendar();
    setScopeDate(null);
    if (layers.main) rememberLayer(layers.main.id, memFromLayer(layers.main));
    for (const e of layers.exc) rememberLayer(e.id, memFromLayer(e));
    for (const e of layers.staticExc) rememberLayer(e.id, memFromLayer(e));
    setLayers(emptyLayerDict());
    setScopeMain(false);
    setWeekdays(new Set());
    setStartMin(6 * 60);
    setEndMin(DAY_MIN + 60);
    setMode('window');
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

  /**
   * Eye + Календарь: полная лента static (как confirm), не только выбранный скоуп.
   * Pencil + Календарь: как раньше — компонент вокруг scopeDate.
   */
  const viewCalAggregate = !editing && onDateScope && scopeDate != null;
  const editDateSpan =
    onDateScope && scopeDate
      ? unionStaticComponentRange(layers.staticExc, scopeDate.from, scopeDate.to)
      : null;
  const viewDateSpan = viewCalAggregate
    ? (unionAllStaticRanges(layers, baseDictRef.current) ?? {
        from: scopeDate!.from,
        to: scopeDate!.to,
      })
    : null;
  const dateChartSpan = viewCalAggregate ? viewDateSpan : editDateSpan;

  const chartColumns: DayColumn[] = dateChartSpan
    ? (() => {
        const single = dateChartSpan.from === dateChartSpan.to;
        const from = single ? addDaysIso(dateChartSpan.from, -CHART_PAD_DAYS) : dateChartSpan.from;
        const to = single ? addDaysIso(dateChartSpan.to, CHART_PAD_DAYS) : dateChartSpan.to;
        const isos = eachIsoDays(from, to);
        // ≤7 колонок — «Ср 01.07» в одну строку; иначе у всех день над датой.
        const stackLabels = isos.length > 7;
        const boardLevels = assignStaticBoardLevels(layers.staticExc);
        const scopeFrom = scopeDate!.from;
        const scopeTo = scopeDate!.to;
        return isos.map((iso) => {
          const w = resolveLayerForDate(layers, iso);
          const cal = calDays.get(iso);
          const inScope = iso >= scopeFrom && iso <= scopeTo;
          const js = new Date(`${iso}T12:00:00`).getDay();
          const dayMoexWin =
            activeTplWin != null
              ? pickWindow(activeTplWin, js === 0 || js === 6 ? 'weekend' : 'weekday')
              : null;
          const dayMoex = dayMoexWin
            ? templateToAxisMins(dayMoexWin.openH, dayMoexWin.openM, dayMoexWin.closeH, dayMoexWin.closeM, 0)
            : null;
          const dow = dowLabelFromIso(iso);
          const dm = fmtChartDatePart(iso, isos.length);
          const resolved = w;
          let layerLabel = resolved?.label;
          if (resolved?.scopeKind === 'date') {
            const idx = layers.staticExc.findIndex((e) => e.id === resolved.id);
            layerLabel = `L${(idx >= 0 ? (boardLevels[idx] ?? 0) : 0) + 1}`;
          } else if (resolved?.scopeKind === 'main') {
            layerLabel = 'Main';
          }
          return {
            key: iso,
            label: stackLabels ? `${dow}\n${dm}` : `${dow}\u00a0${dm}`,
            labelTip: `${dow} ${fmtDdMm(iso)}.${iso.slice(0, 4)}`,
            seg: {
              mode: resolved?.mode ?? 'window',
              startMin: resolved?.startMin ?? 0,
              endMin: resolved?.endMin ?? 0,
              // View-агрегат / Просмотр — все дни яркие; Edit — только скоуп.
              active: viewCalAggregate || showAggregate ? true : inScope,
              baseStartMin: dayMoex?.startMin ?? null,
              baseEndMin: dayMoex?.endMin ?? null,
              nonTrading: cal != null ? !cal.isTrading : undefined,
              layerLabel,
            },
          };
        });
      })()
    : WEEK_JS.map((js) => {
        const w = resolveLayerForDow(layers, js);
        // Подсветка только дней текущего слоя: main → где main выигрывает;
        // dow → дни скоупа. Иначе «Все» зажигало всю неделю вместе с исключениями.
        const active = showAggregate
          ? true
          : scopeMain
            ? w?.scopeKind === 'main'
            : weekdays.has(js);
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
            layerLabel: w?.scopeKind === 'main' ? 'Main' : w?.label,
          },
        };
      });

  /** Дифф чернового словаря против base: новые/изменённые → upsert, снятые из base → cancel. */
  const diffChanges = (): { upserts: PutConnectionScheduleRuleRequest[]; cancels: number[] } => {
    const changeNote = note.trim() || null;
    const base = baseDictRef.current;
    const baseById = new Map(layersBottomToTop(base).map((l) => [l.id, l]));
    const cur = layersBottomToTop(layers);
    const curIds = new Set(cur.map((l) => l.id));

    const upserts: PutConnectionScheduleRuleRequest[] = [];
    for (const l of cur) {
      const b = baseById.get(l.id);
      if (!b || layerDiffers(l, b)) upserts.push(layerToPutBody(l, changeNote));
    }

    const cancels: number[] = [];
    for (const b of layersBottomToTop(base)) {
      if (curIds.has(b.id)) continue;
      const sid = baseSchedIdRef.current.get(b.id);
      if (sid != null) cancels.push(sid);
    }

    return { upserts, cancels };
  };

  const hasPendingChanges = (): boolean => {
    const { upserts, cancels } = diffChanges();
    return upserts.length + cancels.length > 0;
  };

  /** Шаг 1 → 2: собрать дифф и показать превью (без отправки). */
  const approve = () => {
    if (readOnly) return;
    if (!hasPendingChanges()) {
      setMsgBox({
        severity: 'info',
        title: 'Нет изменений',
        message: 'Нет изменений для утверждения.',
      });
      return;
    }
    lockPanelSize();
    setConfirmTemplate(activeTemplate);
    setConfirmCalOn(false);
    setRegularOpen(true);
    setStaticOpen(false);
    setView('confirm');
  };

  /** Шаг 2: отправить всё на сервер. */
  const commit = () => {
    const { upserts, cancels } = diffChanges();
    for (const body of upserts) onUpsertRule(body);
    for (const sid of cancels) onCancelRule(sid);
    hardClose();
  };

  /** Вернуть черновик к сохранённому base (сброс несохранённых правок). */
  const resetDraftToBase = () => {
    const dict = rules.length > 0 ? dictFromRules(rules) : emptyLayerDict();
    setLayers(dict);
    seedLayerMemory(layerMemRef.current, dict);
    baseDictRef.current = dict;
    const schedIds = new Map<string, number>();
    for (const r of rules) {
      const id = ruleLayerId(r);
      if (id) schedIds.set(id, r.scheduleId);
    }
    baseSchedIdRef.current = schedIds;
    setScopeDate(null);
    setAggregateView(false);
    if (dict.main) {
      setScopeMain(true);
      setWeekdays(new Set(WEEKDAY_DAYS));
      setStartMin(dict.main.startMin);
      setEndMin(dict.main.endMin);
      setMode(dict.main.mode);
    } else {
      setScopeMain(false);
      setWeekdays(new Set());
    }
  };

  const doRefreshFromBase = () => {
    resetDraftToBase();
    store.refreshConnectionSchedule(connectionId);
  };

  const handleRefresh = () => {
    if (readOnly) return;
    if (hasPendingChanges()) {
      setMsgBox({
        severity: 'warning',
        title: 'Обновить из базы?',
        message: 'Несохранённые изменения будут потеряны.',
        onConfirm: doRefreshFromBase,
      });
      return;
    }
    doRefreshFromBase();
  };

  const lastChange =
    history.length > 0
      ? history.reduce((a, b) => (Date.parse(b.effectiveFrom) > Date.parse(a.effectiveFrom) ? b : a))
      : null;

  const diffEntries = view === 'confirm' ? computeDiffEntries(baseDictRef.current, layers) : [];
  const cleared = layersBottomToTop(layers).length === 0 && layersBottomToTop(baseDictRef.current).length > 0;

  const diffMain = diffEntries.filter((e) => diffScopeKind(e) === 'main');
  const diffRegular = diffEntries.filter((e) => diffScopeKind(e) === 'regular');
  const diffStatic = diffEntries
    .filter((e) => diffScopeKind(e) === 'static')
    .slice()
    .sort((a, b) => {
      const aFrom = (a.after ?? a.before)?.dateFrom ?? '';
      const bFrom = (b.after ?? b.before)?.dateFrom ?? '';
      if (aFrom !== bFrom) return aFrom < bFrom ? -1 : 1;
      const aTo = (a.after ?? a.before)?.dateTo ?? '';
      const bTo = (b.after ?? b.before)?.dateTo ?? '';
      return aTo < bTo ? -1 : aTo > bTo ? 1 : 0;
    });

  const renderDiffRow = (e: DiffEntry) => (
    <li key={e.id} className={[styles.diffRow, DIFF_SCOPE_BG[diffScopeKind(e)]].join(' ')}>
      <span className={styles.diffStripes} aria-hidden="true">
        {diffStripes(e).map((s, i) => (
          <i key={`${s}-${i}`} className={DIFF_STRIPE_CLASS[s]} />
        ))}
      </span>
      <span className={styles.diffScope}>{e.label}</span>
      <span className={styles.diffWin}>
        {e.kind === 'added'
          ? `→ ${winText(e.after)}`
          : e.kind === 'removed'
            ? `${winText(e.before)} → снять`
            : `${winText(e.before)} → ${winText(e.after)}${durDeltaText(e.before, e.after)}`}
      </span>
      <span className={styles.diffTag}>{diffTag(e)}</span>
    </li>
  );

  /** Confirm-графики: неделя или даты (confirmCal); MOEX base независим от edit. */
  const confirmTplWin = confirmTemplate ? presets[confirmTemplate] : null;
  const confirmStaticSpan = unionAllStaticRanges(layers, baseDictRef.current);
  const hasConfirmStatic = confirmStaticSpan != null;
  const confirmCalActive = confirmCalOn && hasConfirmStatic;

  const confirmDateIsos: string[] = (() => {
    if (!confirmCalActive || !confirmStaticSpan) return [];
    const single = confirmStaticSpan.from === confirmStaticSpan.to;
    const from = single ? addDaysIso(confirmStaticSpan.from, -CHART_PAD_DAYS) : confirmStaticSpan.from;
    const to = single ? addDaysIso(confirmStaticSpan.to, CHART_PAD_DAYS) : confirmStaticSpan.to;
    return eachIsoDays(from, to);
  })();

  const moexBaseForJs = (js: number): { startMin: number; endMin: number } | null => {
    if (!confirmTplWin) return null;
    const dayWin = pickWindow(confirmTplWin, js === 0 || js === 6 ? 'weekend' : 'weekday');
    return dayWin
      ? templateToAxisMins(dayWin.openH, dayWin.openM, dayWin.closeH, dayWin.closeM, 0)
      : null;
  };

  const resultColumns: DayColumn[] = confirmCalActive
    ? (() => {
        const stackLabels = confirmDateIsos.length > 7;
        const boardLevels = assignStaticBoardLevels(layers.staticExc);
        return confirmDateIsos.map((iso) => {
          const resolved = resolveLayerForDate(layers, iso);
          const cal = calDays.get(iso);
          const js = new Date(`${iso}T12:00:00`).getDay();
          const dayMoex = moexBaseForJs(js);
          const dow = dowLabelFromIso(iso);
          const dm = fmtChartDatePart(iso, confirmDateIsos.length);
          let layerLabel = resolved?.label;
          if (resolved?.scopeKind === 'date') {
            const idx = layers.staticExc.findIndex((e) => e.id === resolved.id);
            layerLabel = `L${(idx >= 0 ? (boardLevels[idx] ?? 0) : 0) + 1}`;
          } else if (resolved?.scopeKind === 'main') {
            layerLabel = 'Main';
          }
          return {
            key: iso,
            label: stackLabels ? `${dow}\n${dm}` : `${dow}\u00a0${dm}`,
            labelTip: `${dow} ${fmtDdMm(iso)}.${iso.slice(0, 4)}`,
            seg: {
              mode: resolved?.mode ?? 'window',
              startMin: resolved?.startMin ?? 0,
              endMin: resolved?.endMin ?? 0,
              active: true,
              baseStartMin: dayMoex?.startMin ?? null,
              baseEndMin: dayMoex?.endMin ?? null,
              nonTrading: cal != null ? !cal.isTrading : undefined,
              layerLabel,
            },
          };
        });
      })()
    : WEEK_JS.map((js) => {
        const w = resolveLayerForDow(layers, js);
        const dayMoex = moexBaseForJs(js);
        return {
          key: String(js),
          label: WEEKDAYS.find((x) => x.dow === js)?.label ?? String(js),
          seg: {
            mode: w?.mode ?? 'window',
            startMin: w?.startMin ?? 0,
            endMin: w?.endMin ?? 0,
            active: true,
            baseStartMin: dayMoex?.startMin ?? null,
            baseEndMin: dayMoex?.endMin ?? null,
            layerLabel: w?.scopeKind === 'main' ? 'Main' : w?.label,
          },
        };
      });

  const diffColumns: DayColumn[] = confirmCalActive
    ? (() => {
        const stackLabels = confirmDateIsos.length > 7;
        return confirmDateIsos.map((iso) => {
          const b = layerToIv(resolveLayerForDate(baseDictRef.current, iso));
          const d = layerToIv(resolveLayerForDate(layers, iso));
          const pieces = [
            ...intersectIv(b, d).map((iv) => ({ startMin: iv.s, endMin: iv.e, kind: 'kept' as const })),
            ...subtractIv(d, b).map((iv) => ({ startMin: iv.s, endMin: iv.e, kind: 'added' as const })),
            ...subtractIv(b, d).map((iv) => ({ startMin: iv.s, endMin: iv.e, kind: 'removed' as const })),
          ];
          const dow = dowLabelFromIso(iso);
          const dm = fmtChartDatePart(iso, confirmDateIsos.length);
          const cal = calDays.get(iso);
          return {
            key: iso,
            label: stackLabels ? `${dow}\n${dm}` : `${dow}\u00a0${dm}`,
            labelTip: `${dow} ${fmtDdMm(iso)}.${iso.slice(0, 4)}`,
            seg: {
              mode: 'window' as const,
              startMin: 0,
              endMin: 0,
              active: true,
              diffPieces: pieces,
              nonTrading: cal != null ? !cal.isTrading : undefined,
            },
          };
        });
      })()
    : WEEK_JS.map((js) => {
        const b = layerToIv(resolveLayerForDow(baseDictRef.current, js));
        const d = layerToIv(resolveLayerForDow(layers, js));
        const pieces = [
          ...intersectIv(b, d).map((iv) => ({ startMin: iv.s, endMin: iv.e, kind: 'kept' as const })),
          ...subtractIv(d, b).map((iv) => ({ startMin: iv.s, endMin: iv.e, kind: 'added' as const })),
          ...subtractIv(b, d).map((iv) => ({ startMin: iv.s, endMin: iv.e, kind: 'removed' as const })),
        ];
        return {
          key: String(js),
          label: WEEKDAYS.find((x) => x.dow === js)?.label ?? String(js),
          seg: { mode: 'window' as const, startMin: 0, endMin: 0, active: true, diffPieces: pieces },
        };
      });

  return (
    <div
      className={[styles.backdrop, panelExiting ? styles.backdropOut : ''].filter(Boolean).join(' ')}
      onClick={softClose}
      role="presentation"
    >
      <div
        ref={panelRef}
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
            <Tip
              content={
                view === 'confirm'
                  ? 'Вернуться к редактированию'
                  : editing
                    ? 'Режим редактирования'
                    : 'Режим просмотра'
              }
            >
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => {
                  if (view === 'confirm') {
                    goToEdit();
                    return;
                  }
                  setEditing((v) => {
                    const next = !v;
                    if (!next) setAggregateView(true); // Eye → Просмотр
                    return next;
                  });
                }}
                aria-pressed={editing}
              >
                {editing ? <PencilIcon className={styles.headIcon} /> : <EyeIcon className={styles.headIcon} />}
              </button>
            </Tip>
            <button type="button" className={styles.iconBtn} onClick={hardClose} aria-label="Закрыть">
              <span className={styles.closeGlyph} aria-hidden="true">
                ×
              </span>
            </button>
          </div>
        </header>

        {view === 'edit' && (
        <div className={[styles.editStep, editStepIn ? styles.editStepIn : ''].filter(Boolean).join(' ')}>
        <ScheduleWindowRibbon
          startMin={startMin}
          endMin={endMin}
          highlightDays={highlightDays}
          readOnly={markersLocked || !hasActiveLayer}
          off={mode === 'off'}
          baseStartMin={baseAxis?.startMin ?? null}
          baseEndMin={baseAxis?.endMin ?? null}
          durationLabel={durationLabel}
          onChange={onWindowChange}
        />

        <div className={[styles.section, readOnly ? styles.sectionLocked : ''].filter(Boolean).join(' ')}>
          <span className={styles.sectionTitle}>Правила</span>
          <div className={[styles.chips, styles.chipsSpread].join(' ')}>
            <Tip content="Основное расписание (неделя)" boundaryRef={panelRef}>
              <button
                type="button"
                className={[
                  styles.chip,
                  !showAggregate && layers.main && scopeMain && !onDateScope ? styles.chipOn : '',
                  layers.main && (showAggregate || !(scopeMain && !onDateScope)) ? styles.chipHas : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={readOnly}
                onClick={toggleMain}
              >
                Все
              </button>
            </Tip>
            <span className={styles.chipCluster}>
              <Tip content="Общее расписание" boundaryRef={panelRef}>
                <button
                  type="button"
                  className={[styles.chip, showAggregate ? styles.chipOn : ''].filter(Boolean).join(' ')}
                  disabled={readOnly}
                  onClick={() => {
                    setAggregateView(true);
                    setScopeDate(null);
                  }}
                >
                  Просмотр
                </button>
              </Tip>
              <Tip content="Вернуться к сохранённому расписанию" boundaryRef={panelRef}>
                <button type="button" className={styles.chip} disabled={readOnly} onClick={handleRefresh}>
                  Обновить
                </button>
              </Tip>
              <Tip content="Очистить все установленные" boundaryRef={panelRef}>
                <button
                  type="button"
                  className={styles.chip}
                  disabled={readOnly || !hasAnyLayers}
                  onClick={clearAllChanges}
                >
                  Очистить
                </button>
              </Tip>
            </span>
          </div>
          <div className={styles.chips}>
            <Tip content="Регулярное исключение · Будни" boundaryRef={panelRef}>
              <button
                type="button"
                className={[
                  styles.chip,
                  !showAggregate && !scopeMain && !onDateScope && sameDays(weekdays, WEEKDAY_DAYS) ? styles.chipOn : '',
                  findLayer(layers, false, new Set(WEEKDAY_DAYS)) &&
                  !(!showAggregate && !scopeMain && !onDateScope && sameDays(weekdays, WEEKDAY_DAYS))
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
            <Tip content="Регулярное исключение · Выходные" boundaryRef={panelRef}>
              <button
                type="button"
                className={[
                  styles.chip,
                  !showAggregate && !scopeMain && !onDateScope && sameDays(weekdays, WEEKEND_DAYS) ? styles.chipOn : '',
                  findLayer(layers, false, new Set(WEEKEND_DAYS)) &&
                  !(!showAggregate && !scopeMain && !onDateScope && sameDays(weekdays, WEEKEND_DAYS))
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
              <Tip content="Календарное исключение" boundaryRef={panelRef}>
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
                !showAggregate &&
                !scopeMain &&
                !onDateScope &&
                weekdays.has(w.dow) &&
                !isGroupMask(maskFromDays(weekdays));
              return (
                <Tip key={w.dow} content="Регулярное исключение (день)" block boundaryRef={panelRef}>
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
              Static ·{' '}
              {labelFromDateRange(
                viewCalAggregate && dateChartSpan ? dateChartSpan.from : scopeDate.from,
                viewCalAggregate && dateChartSpan ? dateChartSpan.to : scopeDate.to,
              )}
            </span>
          )}
        </div>

        <div
          className={[
            styles.section,
            readOnly || showAggregate || !hasActiveLayer ? styles.sectionLocked : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span className={styles.sectionTitle}>Режим</span>
          <div className={styles.chips}>
            <Tip content="On/Off по расписанию">
              <button
                type="button"
                className={[styles.chip, !showAggregate && mode === 'window' ? styles.chipOn : '']
                  .filter(Boolean)
                  .join(' ')}
                disabled={readOnly || showAggregate || !hasActiveLayer}
                onClick={() => setScopeMode('window')}
              >
                Окно связи
              </button>
            </Tip>
            <Tip content="Off-интервал (не подключаться)">
              <button
                type="button"
                className={[styles.chip, !showAggregate && mode === 'off' ? styles.chipOn : '']
                  .filter(Boolean)
                  .join(' ')}
                disabled={readOnly || showAggregate || !hasActiveLayer}
                onClick={() => setScopeMode('off')}
              >
                Выключено
              </button>
            </Tip>
          </div>
        </div>

        <div
          className={[
            styles.section,
            readOnly || showAggregate || mode === 'off' || !hasActiveLayer ? styles.sectionLocked : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span className={styles.sectionTitle}>Шаблоны</span>
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
                  disabled={readOnly || showAggregate || mode === 'off' || !hasActiveLayer || !canApply}
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
                    ? `Shift ±${n}ч`
                    : 'Shift недоступен: open уйдёт во вчера, или duration >24ч'
                }
              >
                <button
                  type="button"
                  className={[styles.chip, shiftHours === n ? styles.chipOn : ''].filter(Boolean).join(' ')}
                  disabled={readOnly || showAggregate || mode === 'off' || !hasActiveLayer || !isShiftValid(activeWin, n)}
                  onClick={() => selectShift(n)}
                >
                  {n === 0 ? 'Shift 0' : String(n)}
                </button>
              </Tip>
            ))}
          </div>
          <span className={[styles.meta, !activeTplWin ? styles.metaDisabled : ''].filter(Boolean).join(' ')}>
            {activeTplWin ? (
              <>
                Из market_schedule ·{' '}
                <span className={dayType === 'weekday' ? styles.metaActive : undefined}>
                  будни {fmtWindow(activeTplWin.wd)}
                </span>
                {' · '}
                <span className={dayType === 'weekend' ? styles.metaActive : undefined}>
                  выходные {activeTplWin.we ? fmtWindow(activeTplWin.we) : 'нет торгов'}
                </span>
              </>
            ) : (
              'Из market_schedule'
            )}
          </span>
        </div>

        <WeeklyDayColumns
          key={
            dateChartSpan
              ? `${viewCalAggregate ? 'view-cal' : 'edit-cal'}:${dateChartSpan.from}:${dateChartSpan.to}`
              : 'week'
          }
          columns={chartColumns}
          title={dateChartSpan ? 'Даты' : 'Неделя'}
          defaultExpanded
          onSegClick={editing ? onChartSegClick : undefined}
        />

        {!dateChartSpan && (
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
              /** Слот текущего редактируемого слоя — остальные приглушены. */
              const ribbonOn = (slot: (typeof slots)[number]): boolean => {
                if (showAggregate) return true;
                if (scopeMain) return slot.kind === 'main' && slot.layer != null;
                if (!weekdays.has(w.dow)) return false;
                if (slot.kind === 'main' || !slot.layer) return false;
                if (isGroupMask(dowMask)) {
                  return slot.kind === 'group' && slot.layer.dowMask === dowMask;
                }
                return slot.kind === 'single';
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
                          !ribbonOn(slot) ? styles.regularRibbonDim : '',
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

        {dateChartSpan && (
          <div
            className={[
              styles.regularBoard,
              styles.staticBoard,
              chartColumns.length > 7 ? styles.staticBoardDense : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              gridTemplateColumns: `repeat(${Math.max(chartColumns.length, 1)}, minmax(0, 1fr))`,
            }}
            aria-label={
              viewCalAggregate ? 'Стек слоёв по датам (main · regular · static)' : 'Слои static по датам'
            }
          >
            {chartColumns.map((col) => {
              const js = new Date(`${col.key}T12:00:00`).getDay();
              /** Eye+Календарь: полный стек; Pencil: только static. */
              type DateSlot =
                | ReturnType<typeof regularBoardSlots>[number]
                | { kind: 'static'; layer: ScheduleLayer };
              const slots: DateSlot[] = viewCalAggregate
                ? [
                    ...regularBoardSlots(layers, js),
                    ...staticBoardSlots(layers, col.key).map((layer) => ({
                      kind: 'static' as const,
                      layer,
                    })),
                  ]
                : staticBoardSlots(layers, col.key).map((layer) => ({
                    kind: 'static' as const,
                    layer,
                  }));

              const ribbonBg = (slot: DateSlot): string | undefined => {
                if (slot.kind === 'main') {
                  if (!slot.layer) return undefined;
                  if (slot.layer.mode === 'off') return '#e05555';
                  return layerTone(2);
                }
                if (slot.layer.mode === 'off') return '#e05555';
                if (slot.kind === 'group') return layerTone(0);
                if (slot.kind === 'single') return layerTone(1);
                const idx = layers.staticExc.findIndex((e) => e.id === slot.layer.id);
                const i = idx >= 0 ? idx : 0;
                // Eye+Календарь: жёлтый preview; Pencil: голубые как в календаре.
                return viewCalAggregate ? staticPreviewTone(i) : layerTone(i);
              };

              return (
                <div key={col.key} className={styles.regularCol}>
                  <div className={styles.regularRibbons}>
                    {slots.map((slot, i) => {
                      const unset = slot.kind === 'main' && !slot.layer;
                      const title =
                        slot.kind === 'main'
                          ? slot.layer
                            ? 'Main'
                            : 'Main (нет)'
                          : slot.layer.label;
                      return (
                        <span
                          key={slot.kind === 'main' ? `main-${i}` : `${slot.kind}-${slot.layer.id}`}
                          className={[
                            styles.regularRibbon,
                            unset ? styles.regularRibbonUnset : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          style={unset ? undefined : { background: ribbonBg(slot) }}
                          title={title}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Один слот под графиком: История (view) ↔ Комментарий (edit) — одинаковая высота. */}
        {editing ? (
          <label className={styles.metaBlock}>
            Комментарий
            <input
              type="text"
              className={styles.metaBlockField}
              value={note}
              placeholder="например: брокер рвёт до 07:00"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        ) : (
          <div className={styles.metaBlock}>
            История
            <div className={styles.metaBlockField}>
              {lastChange ? (
                <>
                  Последнее изменение:{' '}
                  <span>{new Date(lastChange.effectiveFrom).toLocaleString('ru-RU')}</span>
                  {' · '}
                  {sourceLabel(lastChange.changeSource)}
                  {lastChange.changeNote ? ` · ${lastChange.changeNote}` : ''}
                </>
              ) : (
                'Изменений пока не было'
              )}
            </div>
          </div>
        )}

        </div>
        )}

        {view === 'confirm' && (
          <section className={styles.confirmStep}>
            <div className={styles.confirmFinal}>
              <div className={styles.confirmFinalHead}>
                <span className={styles.sectionTitle}>Новое</span>
                <div className={styles.chips}>
                  <button
                    type="button"
                    className={[
                      styles.chip,
                      styles.confirmCalChip,
                      confirmCalOn && hasConfirmStatic ? styles.chipOn : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    aria-pressed={confirmCalOn && hasConfirmStatic}
                    disabled={!hasConfirmStatic}
                    onClick={(e) => {
                      setConfirmCalOn((v) => !v);
                      e.currentTarget.blur();
                    }}
                  >
                    <CalendarIcon className={styles.chipIcon} />
                    Календарь
                  </button>
                  {TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      className={[styles.chip, confirmTemplate === tpl.id ? styles.chipOn : '']
                        .filter(Boolean)
                        .join(' ')}
                      aria-pressed={confirmTemplate === tpl.id}
                      onClick={() => setConfirmTemplate((cur) => (cur === tpl.id ? null : tpl.id))}
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>
              </div>
              <WeeklyDayColumns
                key={confirmCalActive ? 'result-cal' : 'result-week'}
                columns={resultColumns}
                title="Что будет установлено"
                defaultExpanded
              />
            </div>

            <div className={styles.confirmDiff}>
              <span className={styles.sectionTitle}>Подтверждение изменений</span>
              <div className={styles.confirmRules}>
                <span className={styles.confirmSubTitle}>Правила</span>
                <ul className={styles.diffList}>
                  {diffMain.map(renderDiffRow)}

                  {diffRegular.length === 1 && renderDiffRow(diffRegular[0]!)}
                  {diffRegular.length >= 2 && (
                    <li className={styles.diffGroup}>
                      <button
                        type="button"
                        className={[
                          styles.diffGroupToggle,
                          !regularOpen ? styles.diffGroupToggleCollapsed : '',
                          !regularOpen ? styles.diffRow_regular : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        aria-expanded={regularOpen}
                        onClick={() => setRegularOpen((v) => !v)}
                      >
                        <span
                          className={[styles.diffGroupChevron, regularOpen ? styles.diffGroupChevronOpen : '']
                            .filter(Boolean)
                            .join(' ')}
                        >
                          ▸
                        </span>
                        {regularOpen ? (
                          <>Регулярные ({diffRegular.length})</>
                        ) : (
                          <span className={styles.diffScope}>Регулярные ({diffRegular.length})</span>
                        )}
                      </button>
                      {regularOpen && <ul className={styles.diffList}>{diffRegular.map(renderDiffRow)}</ul>}
                    </li>
                  )}

                  {diffStatic.length === 1 && renderDiffRow(diffStatic[0]!)}
                  {diffStatic.length >= 2 && (
                    <li className={styles.diffGroup}>
                      <button
                        type="button"
                        className={[
                          styles.diffGroupToggle,
                          !staticOpen ? styles.diffGroupToggleCollapsed : '',
                          !staticOpen ? styles.diffRow_static : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        aria-expanded={staticOpen}
                        onClick={() => setStaticOpen((v) => !v)}
                      >
                        <span
                          className={[styles.diffGroupChevron, staticOpen ? styles.diffGroupChevronOpen : '']
                            .filter(Boolean)
                            .join(' ')}
                        >
                          ▸
                        </span>
                        {staticOpen ? (
                          <>Календарные ({diffStatic.length})</>
                        ) : (
                          <span className={styles.diffScope}>Календарные ({diffStatic.length})</span>
                        )}
                      </button>
                      {staticOpen && <ul className={styles.diffList}>{diffStatic.map(renderDiffRow)}</ul>}
                    </li>
                  )}
                </ul>
                {cleared && (
                  <span className={styles.clearWarn}>
                    <span className={styles.warnIcon} aria-hidden="true">
                      ⚠
                    </span>
                    Расписание будет очищено — автоподключение отключится.
                  </span>
                )}
              </div>
              <div className={styles.confirmDiffChart}>
                <WeeklyDayColumns
                  key={confirmCalActive ? 'diff-cal' : 'diff-week'}
                  columns={diffColumns}
                  title="Что изменится"
                  defaultExpanded
                />
                <div className={styles.diffLegend} aria-hidden="true">
                  <span>
                    <i className={[styles.dot, styles.dotKept].join(' ')} /> без изменений
                  </span>
                  <span>
                    <i className={[styles.dot, styles.dotAdded].join(' ')} /> добавлено
                  </span>
                  <span>
                    <i className={[styles.dot, styles.dotRemoved].join(' ')} /> снято
                  </span>
                </div>
              </div>
            </div>
          </section>
        )}

        <div className={styles.footer}>
        {view === 'edit' ? (
          <button type="button" className={styles.approve} onClick={approve} disabled={readOnly}>
            Утвердить
          </button>
        ) : (
          <div className={styles.confirmFooter}>
            <button type="button" className={styles.backBtn} onClick={goToEdit}>
              ← Вернуться к редактированию
            </button>
            <button type="button" className={styles.approve} onClick={commit}>
              Подтвердить
            </button>
          </div>
        )}
        </div>

      </div>

      {msgBox && (
        <ConfirmDialog
          severity={msgBox.severity}
          title={msgBox.title}
          message={msgBox.message}
          confirmLabel="ОК"
          cancelLabel={msgBox.onConfirm ? 'Отмена' : null}
          onConfirm={() => {
            const next = msgBox.onConfirm;
            setMsgBox(null);
            next?.();
          }}
          onCancel={msgBox.onConfirm ? () => setMsgBox(null) : undefined}
        />
      )}
    </div>
  );
}
