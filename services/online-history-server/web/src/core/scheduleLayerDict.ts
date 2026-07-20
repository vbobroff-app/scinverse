import { dowBit } from './connectionSchedule';
import type { ConnectionScheduleRuleDto } from './types';

/** Черновик слоёв UI: main → periodical (dow) → static (date).
 * Static: порядок as created (createStaticExc сверху + drop nested);
 * выбор существующего (Перейти) порядок не меняет.
 */

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
  /** null = main не задан (только исключения). */
  main: ScheduleLayer | null;
  /** Periodical-исключения (dow): group снизу, single сверху (normalizeRegularExc). */
  exc: ScheduleLayer[];
  /** Static-исключения (date), снизу вверх — поверх periodical. */
  staticExc: ScheduleLayer[];
}

/** Mask будни Пн–Пт. */
export const MASK_WEEKDAYS = 31;
/** Mask Сб+Вс. */
export const MASK_WEEKEND = 96;

export function isGroupMask(mask: number): boolean {
  return mask === MASK_WEEKDAYS || mask === MASK_WEEKEND;
}

/** Один бит = один день. */
export function isSingleDayMask(mask: number): boolean {
  return mask > 0 && (mask & (mask - 1)) === 0;
}

export function groupMaskFromDays(days: readonly number[]): number | null {
  const mask = maskFromDays(new Set(days));
  return isGroupMask(mask) ? mask : null;
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

export function emptyLayerDict(_startMin?: number, _endMin?: number): ScheduleLayerDict {
  return { main: null, exc: [], staticExc: [] };
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
  const main = mainRule ? ruleToLayer(mainRule) : null;
  const byFrom = (a: ConnectionScheduleRuleDto, b: ConnectionScheduleRuleDto) =>
    Date.parse(a.effectiveFrom) - Date.parse(b.effectiveFrom);
  const exc = normalizeRegularExc(
    rules
      .filter((r) => r.scopeKind === 'dow')
      .slice()
      .sort(byFrom)
      .map(ruleToLayer)
      .filter((x): x is ScheduleLayer => x != null),
  );
  const staticExc = rules
    .filter((r) => r.scopeKind === 'date')
    .slice()
    .sort(byFrom)
    .map(ruleToLayer)
    .filter((x): x is ScheduleLayer => x != null);
  return { main, exc, staticExc };
}

/**
 * Стабильный порядок regular: group (Будни/СбВс) снизу, single-дни сверху.
 * Прочие mask — между ними.
 */
export function normalizeRegularExc(exc: readonly ScheduleLayer[]): ScheduleLayer[] {
  const groups: ScheduleLayer[] = [];
  const other: ScheduleLayer[] = [];
  const singles: ScheduleLayer[] = [];
  for (const e of exc) {
    if (e.dowMask == null) continue;
    if (isGroupMask(e.dowMask)) groups.push(e);
    else if (isSingleDayMask(e.dowMask)) singles.push(e);
    else other.push(e);
  }
  return [...groups, ...other, ...singles];
}

/** Поднять periodical-исключение; group XOR; порядок normalizeRegularExc. */
export function promoteExc(dict: ScheduleLayerDict, layer: ScheduleLayer): ScheduleLayerDict {
  if (layer.scopeKind === 'main') {
    return { ...dict, main: layer };
  }
  if (layer.scopeKind === 'date') {
    return promoteStaticExc(dict, layer);
  }
  let rest = dict.exc.filter((e) => e.id !== layer.id);
  if (layer.dowMask != null && isGroupMask(layer.dowMask)) {
    rest = rest.filter((e) => e.dowMask == null || !isGroupMask(e.dowMask));
  }
  return { ...dict, exc: normalizeRegularExc([...rest, layer]) };
}

export function removeExcById(dict: ScheduleLayerDict, id: string): ScheduleLayerDict {
  return { ...dict, exc: normalizeRegularExc(dict.exc.filter((e) => e.id !== id)) };
}

export function findGroupExc(dict: ScheduleLayerDict): ScheduleLayer | undefined {
  return dict.exc.find((e) => e.dowMask != null && isGroupMask(e.dowMask));
}

export function findSingleDayExc(dict: ScheduleLayerDict, jsDay: number): ScheduleLayer | undefined {
  const bit = dowBit(jsDay);
  return dict.exc.find((e) => e.dowMask === bit);
}

/**
 * Tetris-доска periodical по дню (снизу вверх).
 * Этаж 0 всегда забронирован под main (даже если main=null — пустой/серый слот).
 * Single падает на main, если группу этот день не покрывает; иначе сидит над group.
 */
export type RegularBoardSlot =
  | { kind: 'main'; layer: ScheduleLayer | null }
  | { kind: 'group'; layer: ScheduleLayer }
  | { kind: 'single'; layer: ScheduleLayer };

export function regularBoardSlots(dict: ScheduleLayerDict, jsDay: number): RegularBoardSlot[] {
  const slots: RegularBoardSlot[] = [{ kind: 'main', layer: dict.main }];
  const group = findGroupExc(dict);
  const single = findSingleDayExc(dict, jsDay);
  const groupCovers = group?.dowMask != null && (group.dowMask & dowBit(jsDay)) !== 0;

  if (groupCovers && group) {
    slots.push({ kind: 'group', layer: group });
    if (single) slots.push({ kind: 'single', layer: single });
  } else if (single) {
    slots.push({ kind: 'single', layer: single });
  }
  return slots;
}

/** Поднять static-исключение наверх; опционально выкинуть полностью вложенные (Mold ⊆ M). */
export function promoteStaticExc(
  dict: ScheduleLayerDict,
  layer: ScheduleLayer,
  opts?: { dropNested?: boolean },
): ScheduleLayerDict {
  if (layer.scopeKind !== 'date') return promoteExc(dict, layer);
  let rest = dict.staticExc.filter((e) => e.id !== layer.id);
  if (opts?.dropNested && layer.dateFrom && layer.dateTo) {
    const from = layer.dateFrom;
    const to = layer.dateTo;
    rest = rest.filter((e) => {
      if (e.dateFrom == null || e.dateTo == null) return true;
      const nested = e.dateFrom >= from && e.dateTo <= to;
      return !nested;
    });
  }
  return { ...dict, staticExc: [...rest, layer] };
}

/**
 * Создать static-слой сверху (order as created).
 * Полностью вложенные диапазоны (включая exact match) удаляются — только при создании.
 */
export function createStaticExc(dict: ScheduleLayerDict, layer: ScheduleLayer): ScheduleLayerDict {
  return promoteStaticExc(dict, layer, { dropNested: true });
}

/** Пересечение закрытых ISO-диапазонов дат [aFrom,aTo] ∩ [bFrom,bTo]. */
export function datesOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  return aFrom <= bTo && bFrom <= aTo;
}

/**
 * Связная компонента static-слоёв по пересечению дат (транзитивно).
 * Порядок снизу вверх сохраняется. Seed — диапазон выбранного слоя.
 */
export function staticExcConnectedComponent(
  layers: readonly ScheduleLayer[],
  seedFrom: string,
  seedTo: string,
): ScheduleLayer[] {
  const dated = layers.filter((l) => l.dateFrom != null && l.dateTo != null);
  if (dated.length === 0) return [];

  const visited = new Set<number>();
  const queue: number[] = [];
  for (let i = 0; i < dated.length; i++) {
    if (datesOverlap(dated[i].dateFrom!, dated[i].dateTo!, seedFrom, seedTo)) {
      visited.add(i);
      queue.push(i);
    }
  }
  while (queue.length > 0) {
    const i = queue.shift()!;
    for (let j = 0; j < dated.length; j++) {
      if (visited.has(j)) continue;
      if (datesOverlap(dated[i].dateFrom!, dated[i].dateTo!, dated[j].dateFrom!, dated[j].dateTo!)) {
        visited.add(j);
        queue.push(j);
      }
    }
  }
  return dated.filter((_, i) => visited.has(i));
}

/** Объединение дат связной компоненты (или сам seed, если пусто). */
export function unionStaticComponentRange(
  layers: readonly ScheduleLayer[],
  seedFrom: string,
  seedTo: string,
): { from: string; to: string } {
  const component = staticExcConnectedComponent(layers, seedFrom, seedTo);
  if (component.length === 0) return { from: seedFrom, to: seedTo };
  let from = component[0].dateFrom!;
  let to = component[0].dateTo!;
  for (const l of component) {
    if (l.dateFrom! < from) from = l.dateFrom!;
    if (l.dateTo! > to) to = l.dateTo!;
  }
  return { from, to };
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
  if (scopeMain) return dict.main ?? undefined;
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

/** Победитель для дня недели: main → periodical (без static). null = ничего не задано. */
export function resolveLayerForDow(dict: ScheduleLayerDict, jsDay: number): ScheduleLayer | null {
  let winner: ScheduleLayer | null = dict.main;
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
export function resolveLayerForDate(dict: ScheduleLayerDict, iso: string): ScheduleLayer | null {
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
  return [...(dict.main ? [dict.main] : []), ...dict.exc, ...dict.staticExc];
}
