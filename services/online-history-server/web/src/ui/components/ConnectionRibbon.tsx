import { memo } from 'react';
import type { CoverageWindow } from '../../core/OhsStore';
import { livenessEndMs } from '../../core/coverageGeometry';
import { makeProjector } from '../../core/sessionProjection';
import type { CaptureGapDto, IncidentDto, LivenessIntervalDto, SessionDto } from '../../core/types';
import { DEFAULT_LINK_RECOVER_GRACE_SEC, resolveEscalatedMs } from './connectionRibbonGaps';
import {
  projectConnectionIncidents,
  type IncidentRibbonKind,
} from './incidentRibbonProjection';
import styles from './ConnectionRibbon.module.css';

interface Props {
  window: CoverageWindow;
  sessions?: SessionDto[];
  /** Интервалы «сервер работает» (голубое) на подключение (source). */
  intervals?: LivenessIntervalDto[];
  /**
   * Периоды «связь не жива» из link_liveness.
   * При загруженном журнале (`incidents != null`) — только серое + optimistic crash;
   * иначе полный as-is (gaps = источник инцидентов).
   */
  gaps?: CaptureGapDto[];
  /** Журнал `incident` (11.13e). `null`/`undefined` → legacy gaps. */
  incidents?: IncidentDto[] | null;
  /** Текущее время (ms) — правый край открытого интервала связи. */
  nowMs?: number;
  /** Смещение отображаемого ТЗ от UTC (мин) — для подписи времени в тултипах. */
  tzOffsetMin?: number;
  /** T = LinkRecoverGraceSeconds (жёлтое ≤ T). С API `/coverage/link`. */
  linkRecoverGraceSeconds?: number;
}

/** Не-инцидент (серое, без маркеров): отключил оператор / плановое по расписанию. */
const GREY_CAUSES = new Set(['disconnected', 'scheduled']);

function isIncident(cause: string): boolean {
  return !GREY_CAUSES.has(cause);
}

const CAUSE_LABEL: Record<string, string> = {
  disconnected: 'Отключено',
  scheduled: 'Плановое отключение по расписанию',
  degraded: 'Восстановление связи (TRANSAQ)',
  server_down: 'Обрыв связи (сервер не отвечает)',
  ping_failed: 'Связь потеряна (пинг)',
  interrupted: 'Прервано (краш/рестарт бэка)',
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function hhmm(ms: number, offMin: number): string {
  const d = new Date(ms + offMin * 60_000);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function gapClass(cause: string): string {
  if (GREY_CAUSES.has(cause)) return styles.idle;
  if (cause === 'degraded') return styles.lost;
  if (cause === 'interrupted') return styles.down;
  return styles.supervisor;
}

function kindClass(kind: IncidentRibbonKind): string {
  if (kind === 'transaq') return styles.lost;
  if (kind === 'crash') return styles.down;
  return styles.supervisor;
}

/**
 * Лента Connection: голубое ← link_liveness; цветные эпизоды ← журнал `incident` (11.13e).
 * Gaps liveness — серое (и legacy / optimistic crash, пока J8).
 */
export const ConnectionRibbon = memo(function ConnectionRibbon({
  window,
  sessions,
  intervals,
  gaps,
  incidents,
  nowMs,
  tzOffsetMin = 180,
  linkRecoverGraceSeconds = DEFAULT_LINK_RECOVER_GRACE_SEC,
}: Props) {
  const windowFromMs = Date.parse(window.from);
  const windowToMs = Date.parse(window.to);
  const liveEdgeMs = Math.min(nowMs ?? windowToMs, windowToMs);
  const pct = makeProjector(windowFromMs, windowToMs, sessions);
  const graceSec =
    linkRecoverGraceSeconds > 0 ? linkRecoverGraceSeconds : DEFAULT_LINK_RECOVER_GRACE_SEC;
  const useJournal = incidents != null;
  const journalPaint = useJournal
    ? projectConnectionIncidents(incidents, liveEdgeMs, graceSec)
    : null;

  return (
    <div className={styles.track}>
      <span className={styles.nowLine} />

      {intervals?.map((liv, i) => {
        const from = Date.parse(liv.from);
        const to = livenessEndMs(liv, liveEdgeMs, windowToMs);
        if (!liv.open && to <= from) return null;
        const left = pct(from);
        return (
          <div
            key={`c${i}`}
            className={[styles.bar, styles.connected, liv.open ? styles.live : ''].filter(Boolean).join(' ')}
            style={{ left: `${left}%`, width: `${Math.max(0.3, pct(to) - left)}%` }}
            title={`Сервер работает · ${hhmm(from, tzOffsetMin)}–${liv.open ? 'сейчас' : hhmm(to, tzOffsetMin)}`}
          />
        );
      })}

      {useJournal ? (
        <>
          {/* Серое из liveness — не журнал. */}
          {gaps
            ?.filter((g) => GREY_CAUSES.has(g.cause))
            .map((gap, i) => {
              const from = Date.parse(gap.from);
              const to = gap.to ? Date.parse(gap.to) : liveEdgeMs;
              const left = pct(from);
              return (
                <div
                  key={`grey${i}`}
                  className={[styles.bar, styles.idle].join(' ')}
                  style={{ left: `${left}%`, width: `${Math.max(0.3, pct(to) - left)}%` }}
                  title={`${CAUSE_LABEL[gap.cause] ?? gap.cause} · ${hhmm(from, tzOffsetMin)}–${gap.to ? hhmm(to, tzOffsetMin) : 'сейчас'}`}
                />
              );
            })}

          {/* Optimistic client crash (J8) — interrupted gap, пока нет строки crash в журнале. */}
          {gaps
            ?.filter((g) => g.cause === 'interrupted')
            .map((gap, i) => {
              const from = Date.parse(gap.from);
              const to = gap.to ? Date.parse(gap.to) : liveEdgeMs;
              const left = pct(from);
              return (
                <div
                  key={`crash-gap${i}`}
                  className={[styles.bar, styles.down].join(' ')}
                  style={{ left: `${left}%`, width: `${Math.max(0.3, pct(to) - left)}%` }}
                  title={`${CAUSE_LABEL.interrupted} · ${hhmm(from, tzOffsetMin)}–${gap.to ? hhmm(to, tzOffsetMin) : 'сейчас'}`}
                />
              );
            })}

          {journalPaint!.bodies.map((body, i) => {
            const left = pct(body.fromMs);
            return (
              <div
                key={`ib${body.corrUid}-${i}`}
                className={[styles.bar, kindClass(body.kind)].join(' ')}
                style={{
                  left: `${left}%`,
                  width: `${Math.max(0.3, pct(body.toMs) - left)}%`,
                  zIndex: body.z,
                }}
                title={`${body.label} · ${hhmm(body.fromMs, tzOffsetMin)}–${hhmm(body.toMs, tzOffsetMin)}`}
              />
            );
          })}

          {journalPaint!.markers.map((m, i) =>
            m.kind === 'start' ? (
              <span
                key={`is${m.corrUid}-${i}`}
                className={styles.startMarker}
                style={{ left: `${pct(m.atMs)}%` }}
                title={`${m.label} · ${hhmm(m.atMs, tzOffsetMin)}`}
              />
            ) : (
              <span
                key={`ir${m.corrUid}-${i}`}
                className={styles.recover}
                style={{ left: `${pct(m.atMs)}%` }}
                title={`${m.label} · ${hhmm(m.atMs, tzOffsetMin)}`}
              />
            ),
          )}

          {/* Стартовый 1px для optimistic crash gap. */}
          {gaps
            ?.filter((g) => g.cause === 'interrupted')
            .map((gap, i) => (
              <span
                key={`crash-s${i}`}
                className={styles.startMarker}
                style={{ left: `${pct(Date.parse(gap.from))}%` }}
                title={`Потеря связи · ${hhmm(Date.parse(gap.from), tzOffsetMin)}`}
              />
            ))}
        </>
      ) : (
        <>
          {gaps?.flatMap((gap, i) => {
            const from = Date.parse(gap.from);
            const to = gap.to ? Date.parse(gap.to) : liveEdgeMs;
            const label = CAUSE_LABEL[gap.cause] ?? gap.cause;
            const escMs = resolveEscalatedMs(gap, from, to, graceSec);

            if (escMs === null || !isIncident(gap.cause)) {
              const left = pct(from);
              return [
                <div
                  key={`g${i}`}
                  className={[styles.bar, gapClass(gap.cause)].join(' ')}
                  style={{ left: `${left}%`, width: `${Math.max(0.3, pct(to) - left)}%` }}
                  title={`${label} · ${hhmm(from, tzOffsetMin)}–${gap.to ? hhmm(to, tzOffsetMin) : 'сейчас'}`}
                />,
              ];
            }

            const leftA = pct(from);
            const leftB = pct(escMs);
            return [
              <div
                key={`g${i}a`}
                className={[styles.bar, gapClass(gap.cause)].join(' ')}
                style={{ left: `${leftA}%`, width: `${Math.max(0.3, leftB - leftA)}%` }}
                title={`${label} · ${hhmm(from, tzOffsetMin)}–${hhmm(escMs, tzOffsetMin)}`}
              />,
              <div
                key={`g${i}b`}
                className={[styles.bar, styles.supervisor].join(' ')}
                style={{ left: `${leftB}%`, width: `${Math.max(0.3, pct(to) - leftB)}%` }}
                title={`Восстановление связи (супервизор) · ${hhmm(escMs, tzOffsetMin)}–${gap.to ? hhmm(to, tzOffsetMin) : 'сейчас'}`}
              />,
            ];
          })}

          {gaps?.map((gap, i) =>
            isIncident(gap.cause) ? (
              <span
                key={`s${i}`}
                className={styles.startMarker}
                style={{ left: `${pct(Date.parse(gap.from))}%` }}
                title={`Потеря связи · ${hhmm(Date.parse(gap.from), tzOffsetMin)}`}
              />
            ) : null,
          )}

          {gaps?.map((gap, i) =>
            gap.to && isIncident(gap.cause) && !gap.abandoned ? (
              <span
                key={`r${i}`}
                className={styles.recover}
                style={{ left: `${pct(Date.parse(gap.to))}%` }}
                title={`Связь восстановлена · ${hhmm(Date.parse(gap.to), tzOffsetMin)}`}
              />
            ) : null,
          )}
        </>
      )}
    </div>
  );
});
