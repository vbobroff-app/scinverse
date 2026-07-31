import { memo } from 'react';
import type { CoverageWindow } from '../../core/OhsStore';
import {
  SCHEDULE_TZ_OFFSET_MIN,
  formatScheduleIdleTooltip,
  scheduleVoidIntervals,
} from '../../core/connectionSchedule';
import { livenessEndMs } from '../../core/coverageGeometry';
import { makeProjector } from '../../core/sessionProjection';
import type {
  CaptureGapDto,
  ConnectionScheduleRuleDto,
  IncidentDto,
  LivenessIntervalDto,
  SessionDto,
} from '../../core/types';
import { DEFAULT_LINK_RECOVER_GRACE_SEC, resolveEscalatedMs } from './connectionRibbonGaps';
import {
  journalHasOverlappingCrash,
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
   * Слой связи: только серое (disconnected/scheduled).
   * Цветные причины — только в слое инцидентов (journal или legacy fallback).
   */
  gaps?: CaptureGapDto[];
  /** Журнал `incident` (11.13e). `null`/`undefined` + showIncidents → legacy gaps. */
  incidents?: IncidentDto[] | null;
  /** Текущее время (ms) — правый край открытого интервала связи. */
  nowMs?: number;
  /** Смещение отображаемого ТЗ от UTC (мин) — для подписи времени в тултипах. */
  tzOffsetMin?: number;
  /** T = LinkRecoverGraceSeconds (жёлтое ≤ T). С API `/coverage/link`. */
  linkRecoverGraceSeconds?: number;
  /** Вертикаль «сейчас» на правом краю live-ленты (настройка провайдера). */
  showNowMarker?: boolean;
  /** Слой голубого/серого из `link_liveness`. */
  showLinkRibbon?: boolean;
  /** Слой цветных эпизодов + маркеров из `incident`. */
  showIncidents?: boolean;
  /** Верхний void-слой вне desired (schedule-as-projection). */
  showScheduleMask?: boolean;
  /** Живые правила расписания connection (для void mask). */
  scheduleRules?: readonly ConnectionScheduleRuleDto[];
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

/** Ongoing optimistic crash (to=null). Исторический `interrupted` от RecoverOpenIntervals/рестарта
 * Host НЕ красим — иначе длинная красная штриховка без journal/NC инцидента. */

/**
 * Connection: слои снизу вверх — liveness → break/crash → markers → schedule mask.
 * - Лента связи (`showLinkRibbon`): голубое + серое idle из `link_liveness`.
 * - Инциденты (`showIncidents`): journal / legacy gaps + маркеры (не зависят от живности).
 * - Маска расписания (`showScheduleMask`): void вне desired, ⊥ SessionFilter.
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
  showNowMarker = true,
  showLinkRibbon = true,
  showIncidents = true,
  showScheduleMask = true,
  scheduleRules,
}: Props) {
  const windowFromMs = Date.parse(window.from);
  const windowToMs = Date.parse(window.to);
  const liveEdgeMs = Math.min(nowMs ?? windowToMs, windowToMs);
  const pct = makeProjector(windowFromMs, windowToMs, sessions);
  const graceSec =
    linkRecoverGraceSeconds > 0 ? linkRecoverGraceSeconds : DEFAULT_LINK_RECOVER_GRACE_SEC;
  const useJournal = showIncidents && incidents != null;
  const journalPaint = useJournal
    ? projectConnectionIncidents(incidents, liveEdgeMs, graceSec)
    : null;
  const journalList = incidents ?? [];
  const optimisticCrashGaps = useJournal
    ? gaps?.filter((g) => {
        if (g.cause !== 'interrupted' || g.to != null) {
          return false;
        }
        const from = Date.parse(g.from);
        if (!Number.isFinite(from)) {
          return false;
        }
        return !journalHasOverlappingCrash(journalList, from, liveEdgeMs, liveEdgeMs);
      })
    : undefined;
  const voids =
    showScheduleMask && scheduleRules && scheduleRules.length > 0
      ? scheduleVoidIntervals(scheduleRules, windowFromMs, windowToMs, SCHEDULE_TZ_OFFSET_MIN)
      : [];

  return (
    <div className={styles.track}>
      {showNowMarker ? <span className={styles.nowLine} /> : null}

      {/* —— слой связи (link_liveness): только голубое + серое —— */}
      {showLinkRibbon
        ? (intervals ?? []).map((liv, i) => {
            const fromMs = Date.parse(liv.from);
            if (!Number.isFinite(fromMs)) return null;
            const toMs = livenessEndMs(liv, liveEdgeMs, windowToMs);
            if (!liv.open && toMs <= fromMs) return null;
            const left = pct(fromMs);
            const widthPct = pct(toMs) - left;
            if (widthPct <= 0) return null;
            return (
              <div
                key={`c${i}`}
                className={[styles.bar, styles.connected, liv.open ? styles.live : '']
                  .filter(Boolean)
                  .join(' ')}
                style={{ left: `${left}%`, width: `${widthPct}%` }}
                title={`Сервер работает · ${hhmm(fromMs, tzOffsetMin)}–${liv.open ? 'сейчас' : hhmm(toMs, tzOffsetMin)}`}
              />
            );
          })
        : null}

      {showLinkRibbon
        ? gaps
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
            })
        : null}

      {/* —— слой инцидентов: journal или legacy gaps (только если галка включена) —— */}
      {useJournal ? (
        <>
          {optimisticCrashGaps?.map((gap, i) => {
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
                style={{ left: `${pct(m.atMs)}%`, zIndex: 20 }}
                title={`${m.label} · ${hhmm(m.atMs, tzOffsetMin)}`}
              />
            ) : (
              <span
                key={`ir${m.corrUid}-${i}`}
                className={styles.recover}
                style={{ left: `${pct(m.atMs)}%`, zIndex: 20 }}
                title={`${m.label} · ${hhmm(m.atMs, tzOffsetMin)}`}
              />
            ),
          )}

          {optimisticCrashGaps?.map((gap, i) => (
            <span
              key={`crash-s${i}`}
              className={styles.startMarker}
              style={{ left: `${pct(Date.parse(gap.from))}%`, zIndex: 20 }}
              title={`Потеря связи · ${hhmm(Date.parse(gap.from), tzOffsetMin)}`}
            />
          ))}
        </>
      ) : null}

      {showIncidents && !useJournal
        ? gaps?.flatMap((gap, i) => {
            if (GREY_CAUSES.has(gap.cause)) {
              return [];
            }
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
          })
        : null}

      {showIncidents && !useJournal
        ? gaps?.map((gap, i) =>
            isIncident(gap.cause) ? (
              <span
                key={`s${i}`}
                className={styles.startMarker}
                style={{ left: `${pct(Date.parse(gap.from))}%`, zIndex: 20 }}
                title={`Потеря связи · ${hhmm(Date.parse(gap.from), tzOffsetMin)}`}
              />
            ) : null,
          )
        : null}

      {showIncidents && !useJournal
        ? gaps?.map((gap, i) =>
            gap.to && isIncident(gap.cause) && !gap.abandoned ? (
              <span
                key={`r${i}`}
                className={styles.recover}
                style={{ left: `${pct(Date.parse(gap.to))}%`, zIndex: 20 }}
                title={`Связь восстановлена · ${hhmm(Date.parse(gap.to), tzOffsetMin)}`}
              />
            ) : null,
          )
        : null}

      {/* —— schedule void mask (верхний слой; не клипует journal) —— */}
      {voids.map((v, i) => {
        const left = pct(v.fromMs);
        const widthPct = pct(v.toMs) - left;
        if (widthPct <= 0) return null;
        return (
          <div
            key={`void${i}`}
            className={styles.scheduleMask}
            style={{ left: `${left}%`, width: `${widthPct}%` }}
            title={formatScheduleIdleTooltip(v.fromMs, v.toMs, SCHEDULE_TZ_OFFSET_MIN)}
          />
        );
      })}
    </div>
  );
});
