/** Тело POST /api/recovery/outage (crash-dispatch). */
export type HostOutageReportBody = {
  clientId: string;
  from: string;
  to: string | null;
};

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
