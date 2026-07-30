/** Тело POST /api/recovery/outage (crash-dispatch). */
export type HostOutageReportBody = {
  clientId: string;
  from: string;
  to: string | null;
};

/** Очередь сигнала до успешного POST (localStorage). */
export type PendingHostOutageReport = {
  clientId: string;
  fromMs: number;
  /** null = ещё open; non-null = recover. */
  toMs: number | null;
};

export const PENDING_HOST_OUTAGE_KEY = 'ohs.hostOutage.pending';

/** Собрать тело сигнала outage/recover для Host. */
export function buildHostOutageReportBody(
  clientId: string,
  fromMs: number,
  toMs: number | null,
): HostOutageReportBody {
  return {
    clientId,
    from: new Date(fromMs).toISOString(),
    to: toMs === null ? null : new Date(toMs).toISOString(),
  };
}

/** Записать/обновить pending до успешного POST (переживает reload). */
export function savePendingHostOutageReport(report: PendingHostOutageReport): void {
  try {
    localStorage.setItem(PENDING_HOST_OUTAGE_KEY, JSON.stringify(report));
  } catch {
    // private mode / quota — память OhsStore остаётся запасным путём
  }
}

export function loadPendingHostOutageReport(): PendingHostOutageReport | null {
  try {
    const raw = localStorage.getItem(PENDING_HOST_OUTAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PendingHostOutageReport>;
    if (
      typeof parsed.clientId !== 'string' ||
      !parsed.clientId.trim() ||
      typeof parsed.fromMs !== 'number' ||
      !Number.isFinite(parsed.fromMs)
    ) {
      clearPendingHostOutageReport();
      return null;
    }
    const toMs =
      parsed.toMs === null || parsed.toMs === undefined
        ? null
        : typeof parsed.toMs === 'number' && Number.isFinite(parsed.toMs)
          ? parsed.toMs
          : null;
    return { clientId: parsed.clientId.trim(), fromMs: parsed.fromMs, toMs };
  } catch {
    return null;
  }
}

/** Снять после успешного POST /recovery/outage. */
export function clearPendingHostOutageReport(): void {
  try {
    localStorage.removeItem(PENDING_HOST_OUTAGE_KEY);
  } catch {
    // ignore
  }
}
