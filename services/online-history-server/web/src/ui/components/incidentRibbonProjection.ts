import type { IncidentDto } from '../../core/types';

/** Вид тела на Connection-ленте. */
export type IncidentRibbonKind = 'break' | 'crash';

export interface IncidentRibbonBody {
  corrUid: string;
  fromMs: number;
  toMs: number;
  kind: IncidentRibbonKind;
  /** Подпись тела без времени (время добавляет Ribbon). */
  label: string;
  /** break=2, crash=3 — поверх связи (§5.2). */
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

const Z_BREAK = 2;
const Z_CRASH = 3;

function episodeEndMs(incident: IncidentDto, nowMs: number): number {
  if (incident.closedAt) {
    const closed = Date.parse(incident.closedAt);
    return Number.isFinite(closed) ? closed : nowMs;
  }
  return nowMs;
}

/**
 * Connection-лента: тела + 1px маркеры из журнала `incident`.
 * break — жёлтая лента на весь span; crash — красная поверх (z). Маркеры — отдельно.
 */
export function projectConnectionIncidents(
  incidents: readonly IncidentDto[],
  nowMs: number,
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

    const isCrash = incident.type === 'crash';
    markers.push({
      corrUid: incident.corrUid,
      atMs: fromMs,
      kind: 'start',
      label: isCrash ? 'Системный сбой' : 'Потеря связи',
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
        label: isCrash ? 'Система восстановлена' : 'Связь восстановлена',
      });
    }

    if (isCrash) {
      bodies.push({
        corrUid: incident.corrUid,
        fromMs,
        toMs,
        kind: 'crash',
        label: 'Сервер недоступен',
        z: Z_CRASH,
      });
      continue;
    }

    bodies.push({
      corrUid: incident.corrUid,
      fromMs,
      toMs,
      kind: 'break',
      label: 'Отсутствие связи',
      z: Z_BREAK,
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
