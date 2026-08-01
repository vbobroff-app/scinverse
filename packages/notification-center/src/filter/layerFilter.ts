import type { NotificationEvent, NotificationItem } from '../types';

/** Слой NC (канон T/C/W): TL=транспорт, CL=коннекторы, WL=запись. */
export type NcLayer = 'tl' | 'cl' | 'wl';

export interface LayerDockFilter {
  tl: boolean;
  cl: boolean;
  wl: boolean;
}

/** По умолчанию: транспорт + коннекторы; запись выкл. */
export const DEFAULT_LAYER_FILTER: LayerDockFilter = {
  tl: true,
  cl: true,
  wl: false,
};

export const EMPTY_LAYER_FILTER: LayerDockFilter = { ...DEFAULT_LAYER_FILTER };

const LAYER_LABEL: Record<NcLayer, string> = {
  tl: 'TL',
  cl: 'CL',
  wl: 'WL',
};

export function normalizeLayerFilter(
  value: Partial<LayerDockFilter> | null | undefined,
): LayerDockFilter {
  return {
    tl: value?.tl !== false,
    cl: value?.cl !== false,
    // WL default off — только явный true включает.
    wl: value?.wl === true,
  };
}

/** Все три on / все off / смешанный. */
export function layerFilterAllState(
  layers: LayerDockFilter,
): 'all' | 'none' | 'mixed' {
  if (layers.tl && layers.cl && layers.wl) {
    return 'all';
  }
  if (!layers.tl && !layers.cl && !layers.wl) {
    return 'none';
  }
  return 'mixed';
}

export function isLayerFilterDefault(layers: LayerDockFilter): boolean {
  return layers.tl === DEFAULT_LAYER_FILTER.tl
    && layers.cl === DEFAULT_LAYER_FILTER.cl
    && layers.wl === DEFAULT_LAYER_FILTER.wl;
}

export function layerFilterSummary(layers: LayerDockFilter): string {
  const on = (['tl', 'cl', 'wl'] as const).filter((k) => layers[k]);
  if (on.length === 3) {
    return 'все';
  }
  if (on.length === 0) {
    return 'нет';
  }
  return on.map((k) => LAYER_LABEL[k]).join('+');
}

function classifyCorrOrSubject(key: string): NcLayer | null {
  if (
    key.startsWith('ohs.host.transport')
    || key.startsWith('ohs.backend.outage')
  ) {
    return 'tl';
  }
  if (/^connection:\d+:/.test(key)) {
    return 'cl';
  }
  return null;
}

/**
 * Классификация атома → слой.
 * Crash / Host transport → TL; break / connection.* → CL; recording/writer → WL.
 * Один эпизод = один слой (Thread классифицируем по uid/subject).
 */
export function classifyEventLayer(event: NotificationEvent): NcLayer {
  const corr = event.correlationId ?? '';
  const subject = event.subject ?? '';
  const byCorr = classifyCorrOrSubject(corr) ?? classifyCorrOrSubject(subject);
  if (byCorr) {
    return byCorr;
  }

  const kind = event.data && typeof event.data.kind === 'string'
    ? event.data.kind
    : undefined;
  if (kind === 'crash') {
    return 'tl';
  }
  if (kind === 'break') {
    return 'cl';
  }

  const code = event.code ?? '';
  if (
    code === 'host.unreachable'
    || code === 'host.reachable'
    || code === 'backend.unavailable'
    || code === 'backend.recovered'
  ) {
    return 'tl';
  }
  if (
    code.startsWith('recording.')
    || code.startsWith('coverage.')
    || code.startsWith('writer.')
  ) {
    return 'wl';
  }
  const module = event.module ?? '';
  if (
    module.includes('recording')
    || module.includes('writer')
    || module.includes('coverage')
  ) {
    return 'wl';
  }
  if (code.startsWith('connection.') || kind === 'break') {
    return 'cl';
  }
  // Прочий system без connection — ближе к транспорту admin↔Host.
  return 'tl';
}

/** Слой контейнера: Thread — по uid/subject; Single — по атому. */
export function classifyItemLayer(item: NotificationItem): NcLayer {
  if (item.itemKind === 'thread') {
    const byUid = classifyCorrOrSubject(item.uid)
      ?? (item.subject ? classifyCorrOrSubject(item.subject) : null);
    if (byUid) {
      return byUid;
    }
    const first = item.notifications[0];
    return first ? classifyEventLayer(first) : 'tl';
  }
  return classifyEventLayer(item);
}

export function matchesLayerFilter(
  item: NotificationItem,
  layers: LayerDockFilter | undefined,
): boolean {
  if (!layers) {
    return true;
  }
  const layer = classifyItemLayer(item);
  return layers[layer];
}
