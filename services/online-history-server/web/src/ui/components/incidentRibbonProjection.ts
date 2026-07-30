import type { IncidentDto } from '../../core/types';
import { DEFAULT_LINK_RECOVER_GRACE_SEC } from './connectionRibbonGaps';

/** Вид тела на Connection-ленте (полная семантика журнала). */
export type IncidentRibbonKind = 'transaq' | 'supervisor' | 'crash';

export interface IncidentRibbonBody {
  corrUid: string;
  fromMs: number;
  toMs: number;
  kind: IncidentRibbonKind;
  label: string;
  /** crash рисуется поверх break. */
  z: number;
}

export interface IncidentRibbonMarker {
  corrUid: string;
  atMs: number;
  kind: 'start' | 'recover';
  label: string;
}

export interface IncidentRibbonPaint {
  bodies: IncidentRibbonBody[];
  markers: IncidentRibbonMarker[];
}

/**
 * Момент жёлтое→красное из полей журнала (аналог resolveEscalatedMs для gaps).
 * Сразу supervisor / без жёлтой фазы → null (всё тело красное).
 */
export function resolveIncidentEscalatedMs(
  incident: Pick<IncidentDto, 'escalatedAt' | 'owner' | 'subtype' | 'type'>,
  fromMs: number,
  toMs: number,
  graceSec: number = DEFAULT_LINK_RECOVER_GRACE_SEC,
): number | null {
  if (incident.type === 'crash') {
    return null;
  }

  const graceMs = (graceSec > 0 ? graceSec : DEFAULT_LINK_RECOVER_GRACE_SEC) * 1000;
  const maxEsc = fromMs + graceMs;

  if (incident.escalatedAt) {
    const esc = Date.parse(incident.escalatedAt);
    if (Number.isFinite(esc) && esc > fromMs && esc < toMs) {
      const t = Math.min(esc, maxEsc);
      return t > fromMs && t < toMs ? t : null;
    }
  }

  // Жёлтая фаза только пока owner=transaq / subtype=degraded.
  const yellowOwner =
    incident.owner === 'transaq' || incident.subtype === 'degraded';
  if (!yellowOwner) {
    return null;
  }

  if (maxEsc > fromMs && maxEsc < toMs) {
    return maxEsc;
  }

  return null;
}

function episodeEndMs(incident: IncidentDto, nowMs: number): number {
  if (incident.closedAt) {
    const closed = Date.parse(incident.closedAt);
    return Number.isFinite(closed) ? closed : nowMs;
  }
  return nowMs;
}

function breakLabel(incident: IncidentDto): string {
  if (incident.subtype === 'degraded' || incident.owner === 'transaq') {
    return 'Восстановление связи (TRANSAQ)';
  }
  return incident.title || 'Обрыв связи';
}

/**
 * Connection-лента: тела + 1px маркеры из журнала `incident` as-is (MVP, без фильтра микро-flap).
 * break снизу, crash сверху (z). Grey (disconnected/scheduled) сюда не входит.
 */
export function projectConnectionIncidents(
  incidents: readonly IncidentDto[],
  nowMs: number,
  graceSec: number = DEFAULT_LINK_RECOVER_GRACE_SEC,
): IncidentRibbonPaint {
  const bodies: IncidentRibbonBody[] = [];
  const markers: IncidentRibbonMarker[] = [];

  for (const incident of incidents) {
    const fromMs = Date.parse(incident.openedAt);
    if (!Number.isFinite(fromMs)) {
      continue;
    }
    const toMs = episodeEndMs(incident, nowMs);
    if (toMs <= fromMs) {
      continue;
    }

    markers.push({
      corrUid: incident.corrUid,
      atMs: fromMs,
      kind: 'start',
      label: incident.type === 'crash' ? 'Недоступность системы' : 'Потеря связи',
    });

    if (
      incident.closedAt &&
      incident.closeOutcome === 'recovered' &&
      Number.isFinite(Date.parse(incident.closedAt))
    ) {
      markers.push({
        corrUid: incident.corrUid,
        atMs: Date.parse(incident.closedAt),
        kind: 'recover',
        label: incident.type === 'crash' ? 'Система восстановлена' : 'Связь восстановлена',
      });
    }

    if (incident.type === 'crash') {
      bodies.push({
        corrUid: incident.corrUid,
        fromMs,
        toMs,
        kind: 'crash',
        label: incident.title || 'Недоступность бэка',
        z: 2,
      });
      continue;
    }

    const escMs = resolveIncidentEscalatedMs(incident, fromMs, toMs, graceSec);
    if (escMs == null) {
      const kind: IncidentRibbonKind =
        incident.owner === 'transaq' || incident.subtype === 'degraded'
          ? 'transaq'
          : 'supervisor';
      bodies.push({
        corrUid: incident.corrUid,
        fromMs,
        toMs,
        kind,
        label: kind === 'transaq' ? breakLabel(incident) : 'Восстановление связи (супервизор)',
        z: 1,
      });
      continue;
    }

    bodies.push({
      corrUid: incident.corrUid,
      fromMs,
      toMs: escMs,
      kind: 'transaq',
      label: breakLabel(incident),
      z: 1,
    });
    bodies.push({
      corrUid: incident.corrUid,
      fromMs: escMs,
      toMs,
      kind: 'supervisor',
      label: 'Восстановление связи (супервизор)',
      z: 1,
    });
  }

  bodies.sort((a, b) => a.z - b.z || a.fromMs - b.fromMs);
  markers.sort((a, b) => a.atMs - b.atMs);
  return { bodies, markers };
}

export interface MergedRedSpan {
  fromMs: number;
  toMs: number;
}

/**
 * J8: optimistic `interrupted` gap не нужен, если в журнале уже есть пересекающийся crash.
 */
export function journalHasOverlappingCrash(
  incidents: readonly IncidentDto[],
  gapFromMs: number,
  gapToMs: number,
  nowMs: number,
): boolean {
  for (const incident of incidents) {
    if (incident.type !== 'crash') {
      continue;
    }
    const fromMs = Date.parse(incident.openedAt);
    if (!Number.isFinite(fromMs)) {
      continue;
    }
    const toMs = episodeEndMs(incident, nowMs);
    if (fromMs < gapToMs && toMs > gapFromMs) {
      return true;
    }
  }
  return false;
}

/**
 * Recording-лента: бинарная проекция журнала — merge перекрытий, без type/owner/маркеров.
 */
export function mergeIncidentReds(
  incidents: readonly IncidentDto[],
  nowMs: number,
): MergedRedSpan[] {
  const spans: MergedRedSpan[] = [];
  for (const incident of incidents) {
    const fromMs = Date.parse(incident.openedAt);
    if (!Number.isFinite(fromMs)) {
      continue;
    }
    const toMs = episodeEndMs(incident, nowMs);
    if (toMs <= fromMs) {
      continue;
    }
    spans.push({ fromMs, toMs });
  }

  spans.sort((a, b) => a.fromMs - b.fromMs);
  const merged: MergedRedSpan[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (!last || span.fromMs > last.toMs) {
      merged.push({ ...span });
      continue;
    }
    last.toMs = Math.max(last.toMs, span.toMs);
  }
  return merged;
}
