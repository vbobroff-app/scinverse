import { dowBit } from './connectionSchedule';
import type { ConnectionScheduleRuleDto } from './types';

/** Черновик слоёв UI: main → periodical (dow) → static (date). Внутри уровня — last refresh наверху. */

export type LayerMode = 'window' | 'off';

export interface ScheduleLayer {
  /** `main` | `dow:<mask>` | `date:<from>:<to>` */
  id: string;
  scopeKind: 'main' | 'dow' | 'date';
  /** null для main / date */
  dowMask: number | null;
  /** null для main / dow */
  dateFrom: string | null;
  dateTo: string | null;
  label: string;
  mode: LayerMode;
  startMin: number;
  endMin: number;
}

export interface ScheduleLayerDict {
  main: ScheduleLayer;
  /** Periodical-исключения (dow), снизу вверх. */
  exc: ScheduleLayer[];
  /** Static-исключения (date), снизу вверх — поверх periodical. */
  staticExc: ScheduleLayer[];
}

const DOW_SHORT: { bit: number; js: number; label: string }[] = [
  { bit: 1, js: 1, label: 'Пн' },
  { bit: 2, js: 2, label: 'Вт' },
  { bit: 4, js: 3, label: 'Ср' },
  { bit: 8, js: 4, label: 'Чт' },
  { bit: 16, js: 5, label: 'Пт' },
  { bit: 32, js: 6, label: 'Сб' },
  { bit: 64, js: 0, label: 'Вс' },
];

const DOW_LABEL_BY_JS: Record<number, string> = {
  0: 'Вс',
  1: 'Пн',
  2: 'Вт',
  3: 'Ср',
  4: 'Чт',
  5: 'Пт',
  6: 'Сб',
};

export function maskFromDays(days: ReadonlySet<number>): number {
  let mask = 0;
  for (const d of days) {
    mask |= dowBit(d);
  }
  return mask;
}

export function daysFromMask(mask: number): number[] {
  return DOW_SHORT.filter((d) => (mask & d.bit) !== 0).map((d) => d.js);
}

export function labelFromMask(mask: number): string {
  if (mask === 31) return 'Будни';
  if (mask === 96) return 'Сб, Вс';
  if (mask === 127) return 'Все дни';
  return DOW_SHORT.filter((d) => (mask & d.bit) !== 0)
    .map((d) => d.label)
    .join(',');
}

export function labelFromDateRange(from: string, to: string): string {
  const fmt = (iso: string) => `${iso.slice(8)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`;
  return from === to ? fmt(from) : `${fmt(from)}–${fmt(to)}`;
}

export function layerIdMain(): string {
  return 'main';
}

export function layerIdDow(mask: number): string {
  return `dow:${mask}`;
}

export function layerIdDate(from: string, to: string): string {
  return `date:${from}:${to}`;
}

export function defaultMainLayer(startMin = 6 * 60, endMin = 24 * 60 + 60): ScheduleLayer {
  return {
    id: layerIdMain(),
    scopeKind: 'main',
    dowMask: null,
    dateFrom: null,
    dateTo: null,
    label: 'Все',
    mode: 'window',
    startMin,
    endMin,
  };
}

export function emptyLayerDict(startMin?: number, endMin?: number): ScheduleLayerDict {
  return { main: defaultMainLayer(startMin, endMin), exc: [], staticExc: [] };
}

function parseWindow(rule: ConnectionScheduleRuleDto): { mode: LayerMode; startMin: number; endMin: number } {
  const mode: LayerMode = rule.mode === 'off' ? 'off' : 'window';
  let startMin = 6 * 60;
  let endMin = 24 * 60 + 60;
  if (mode === 'window' && rule.open != null && rule.durationMin != null) {
    const [h, m] = rule.open.split(':').map(Number);
    startMin = (h || 0) * 60 + (m || 0);
    endMin = startMin + rule.durationMin;
  }
  return { mode, startMin, endMin };
}

function ruleToLayer(rule: ConnectionScheduleRuleDto): ScheduleLayer | null {
  const { mode, startMin, endMin } = parseWindow(rule);
  if (rule.scopeKind === 'main') {
    return {
      id: layerIdMain(),
      scopeKind: 'main',
      dowMask: null,
      dateFrom: null,
      dateTo: null,
      label: 'Все',
      mode,
      startMin,
      endMin,
    };
  }
  if (rule.scopeKind === 'dow') {
    const mask = rule.dowMask ?? 0;
    if (mask <= 0) return null;
    return {
      id: layerIdDow(mask),
      scopeKind: 'dow',
      dowMask: mask,
      dateFrom: null,
      dateTo: null,
      label: labelFromMask(mask),
      mode,
      startMin,
      endMin,
    };
  }
  if (rule.scopeKind === 'date') {
    const from = rule.dateFrom;
    const to = rule.dateTo;
    if (!from || !to) return null;
    return {
      id: layerIdDate(from, to),
      scopeKind: 'date',
      dowMask: null,
      dateFrom: from,
      dateTo: to,
      label: labelFromDateRange(from, to),
      mode,
      startMin,
      endMin,
    };
  }
  return null;
}

/** Живые правила сервера → словарь (exc / staticExc по effectiveFrom ASC = низ → верх). */
export function dictFromRules(rules: readonly ConnectionScheduleRuleDto[]): ScheduleLayerDict {
  const mainRule = rules.find((r) => r.scopeKind === 'main');
  const main = mainRule ? ruleToLayer(mainRule) ?? defaultMainLayer() : defaultMainLayer();
  const byFrom = (a: ConnectionScheduleRuleDto, b: ConnectionScheduleRuleDto) =>
    Date.parse(a.effectiveFrom) - Date.parse(b.effectiveFrom);
  const exc = rules
    .filter((r) => r.scopeKind === 'dow')
    .slice()
    .sort(byFrom)
    .map(ruleToLayer)
    .filter((x): x is ScheduleLayer => x != null);
  const staticExc = rules
    .filter((r) => r.scopeKind === 'date')
    .slice()
    .sort(byFrom)
    .map(ruleToLayer)
    .filter((x): x is ScheduleLayer => x != null);
  return { main, exc, staticExc };
}

/** Поднять periodical-исключение наверх. Main не трогаем. */
export function promoteExc(dict: ScheduleLayerDict, layer: ScheduleLayer): ScheduleLayerDict {
  if (layer.scopeKind === 'main') {
    return { ...dict, main: layer };
  }
  if (layer.scopeKind === 'date') {
    return promoteStaticExc(dict, layer);
  }
  const rest = dict.exc.filter((e) => e.id !== layer.id);
  return { ...dict, exc: [...rest, layer] };
}

/** Поднять static-исключение наверх. */
export function promoteStaticExc(dict: ScheduleLayerDict, layer: ScheduleLayer): ScheduleLayerDict {
  if (layer.scopeKind !== 'date') return promoteExc(dict, layer);
  const rest = dict.staticExc.filter((e) => e.id !== layer.id);
  return { ...dict, staticExc: [...rest, layer] };
}

export function upsertLayer(dict: ScheduleLayerDict, layer: ScheduleLayer): ScheduleLayerDict {
  if (layer.scopeKind === 'main') {
    return { ...dict, main: layer };
  }
  if (layer.scopeKind === 'date') {
    return promoteStaticExc(dict, layer);
  }
  return promoteExc(dict, layer);
}

export function findLayer(
  dict: ScheduleLayerDict,
  scopeMain: boolean,
  days: ReadonlySet<number>,
): ScheduleLayer | undefined {
  if (scopeMain) return dict.main;
  const id = layerIdDow(maskFromDays(days));
  return dict.exc.find((e) => e.id === id);
}

export function findDateLayer(
  dict: ScheduleLayerDict,
  from: string,
  to: string,
): ScheduleLayer | undefined {
  const id = layerIdDate(from, to);
  return dict.staticExc.find((e) => e.id === id);
}

/** Победитель для дня недели: main → periodical (без static). */
export function resolveLayerForDow(dict: ScheduleLayerDict, jsDay: number): ScheduleLayer {
  let winner = dict.main;
  for (const layer of dict.exc) {
    if (layer.dowMask != null && (layer.dowMask & dowBit(jsDay)) !== 0) {
      winner = layer;
    }
  }
  return winner;
}

/** ISO `yyyy-MM-dd` → js day 0=Вс..6=Сб. */
export function jsDayFromIso(iso: string): number {
  return new Date(`${iso}T12:00:00`).getDay();
}

export function dowLabelFromIso(iso: string): string {
  return DOW_LABEL_BY_JS[jsDayFromIso(iso)] ?? iso;
}

/** Победитель для календарной даты: main → periodical → static. */
export function resolveLayerForDate(dict: ScheduleLayerDict, iso: string): ScheduleLayer {
  let winner = resolveLayerForDow(dict, jsDayFromIso(iso));
  for (const layer of dict.staticExc) {
    if (layer.dateFrom != null && layer.dateTo != null && iso >= layer.dateFrom && iso <= layer.dateTo) {
      winner = layer;
    }
  }
  return winner;
}

/** Есть ли живое/черновое static-исключение, покрывающее день. */
export function hasStaticExcOn(dict: ScheduleLayerDict, iso: string): boolean {
  return dict.staticExc.some(
    (layer) => layer.dateFrom != null && layer.dateTo != null && iso >= layer.dateFrom && iso <= layer.dateTo,
  );
}

/** Слои снизу вверх для отладки. */
export function layersBottomToTop(dict: ScheduleLayerDict): ScheduleLayer[] {
  return [dict.main, ...dict.exc, ...dict.staticExc];
}
