import { memo, type MouseEvent as ReactMouseEvent } from 'react';
import type { CoverageWindow } from '../../core/OhsStore';
import {
  SCHEDULE_TZ_OFFSET_MIN,
  buildScheduleDesiredSegs,
  buildScheduleMaskSegs,
  enumerateDesiredWindows,
  formatScheduleDesiredTooltip,
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
import {
  journalHasOverlappingCrash,
  projectConnectionIncidents,
  type IncidentRibbonKind,
} from './incidentRibbonProjection';
import styles from './ConnectionRibbon.module.css';

export type RibbonTipHandlers = {
  onTip: (label: string, clientX: number) => void;
  onTipClear: () => void;
};

interface Props {
  window: CoverageWindow;
  sessions?: SessionDto[];
  /** Интервалы «система подключена» (голубое) на подключение (source). */
  intervals?: LivenessIntervalDto[];
  /**
   * Периоды «связь не жива» из link_liveness.
   * Всегда: серое idle + optimistic crash overlay.
   * Цветные break/crash из gaps — только если `paintGapsAsIncidents` (off by default).
   */
  gaps?: CaptureGapDto[];
  /** Журнал `incident` — канон цветных эпизодов (когда `paintGapsAsIncidents` off). */
  incidents?: IncidentDto[] | null;
  /** Текущее время (ms) — правый край открытого интервала связи. */
  nowMs?: number;
  /** Смещение отображаемого ТЗ от UTC (мин) — для подписи времени в тултипах. */
  tzOffsetMin?: number;
  /** @deprecated жёлтая склейка убрана; оставлен для совместимости вызовов. */
  linkRecoverGraceSeconds?: number;
  /** Вертикаль «сейчас» на правом краю live-ленты (настройка провайдера). */
  showNowMarker?: boolean;
  /** Слой голубого/серого из `link_liveness`. */
  showLinkRibbon?: boolean;
  /** Жёлтый break (`type=break`) + маркеры. */
  showBreakIncidents?: boolean;
  /** Красный crash (`type=crash`) + маркеры / optimistic. */
  showCrashIncidents?: boolean;
  /**
   * Рисовать break/crash из gaps (cause→цвет), а не из journal.
   * Default **off**: journal = факты поломок; gaps = срез живности.
   * On — предпросмотр/восстановление по liveness (механизм сохранён, UI выключен).
   */
  paintGapsAsIncidents?: boolean;
  /** Верхний void-слой вне desired (schedule-as-projection). */
  showScheduleMask?: boolean;
  /** Живые правила расписания connection (для void mask). */
  scheduleRules?: readonly ConnectionScheduleRuleDto[];
  /** Кастомный тултип (стиль линейки), ниже мыши — в родителе. */
  tip?: RibbonTipHandlers;
}

/** Серое idle на слое связи (не инцидент): оператор / плановый простой. */
const GREY_CAUSES = new Set(['disconnected', 'scheduled']);

function isIncidentCause(cause: string): boolean {
  return !GREY_CAUSES.has(cause);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function hhmm(ms: number, offMin: number): string {
  const d = new Date(ms + offMin * 60_000);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function tipRange(fromMs: number, toMs: number, open: boolean, offMin: number): string {
  return `${hhmm(fromMs, offMin)}–${open ? 'сейчас' : hhmm(toMs, offMin)}`;
}

function tipLabel(label: string, time: string): string {
  return `${label} · ${time}`;
}

function kindClass(kind: IncidentRibbonKind): string {
  return kind === 'crash' ? styles.crashBar : styles.breakBar;
}

function gapIncidentBodyClass(cause: string): string {
  return cause === 'interrupted' ? styles.crashBar : styles.breakBar;
}

function gapIncidentBodyLabel(cause: string): string {
  return cause === 'interrupted' ? 'Сервер недоступен' : 'Восстановление связи';
}

function greyLabel(cause: string): string {
  if (cause === 'scheduled') {
    return 'Плановый простой по расписанию';
  }
  return 'Отключено';
}

type TipBind = {
  onMouseEnter: (e: ReactMouseEvent) => void;
  onMouseMove: (e: ReactMouseEvent) => void;
  onMouseLeave: () => void;
};

function bindTip(
  label: string,
  tip?: RibbonTipHandlers,
): TipBind | { title: string } {
  if (!tip) {
    return { title: label };
  }
  return {
    onMouseEnter: (e: ReactMouseEvent) => tip.onTip(label, e.clientX),
    onMouseMove: (e: ReactMouseEvent) => tip.onTip(label, e.clientX),
    onMouseLeave: () => tip.onTipClear(),
  };
}

/**
 * Connection: слои снизу вверх — liveness → break → crash → markers → schedule mask (§5.2).
 */
export const ConnectionRibbon = memo(function ConnectionRibbon({
  window,
  sessions,
  intervals,
  gaps,
  incidents,
  nowMs,
  tzOffsetMin = 180,
  showNowMarker = true,
  showLinkRibbon = true,
  showBreakIncidents = true,
  showCrashIncidents = true,
  paintGapsAsIncidents = false,
  showScheduleMask = true,
  scheduleRules,
  tip,
}: Props) {
  const windowFromMs = Date.parse(window.from);
  const windowToMs = Date.parse(window.to);
  const liveEdgeMs = Math.min(nowMs ?? windowToMs, windowToMs);
  const pct = makeProjector(windowFromMs, windowToMs, sessions);
  const showAnyIncidents = showBreakIncidents || showCrashIncidents;
  // Default: journal. Flag on: gaps→цвет (оба cause); journal не красим. Тумблеры break/crash в UI сняты mutex'ом.
  const useGapIncidents = paintGapsAsIncidents;
  const useJournalIncidents = !paintGapsAsIncidents && incidents != null && showAnyIncidents;
  const journalList = useJournalIncidents
    ? incidents!.filter((i) =>
        i.type === 'crash' ? showCrashIncidents : showBreakIncidents,
      )
    : [];
  const journalPaint = useJournalIncidents
    ? projectConnectionIncidents(journalList, liveEdgeMs)
    : null;
  // D7: open interrupted overlay — не то же самое, что paintGapsAsIncidents.
  const optimisticCrashGaps =
    showCrashIncidents && !useGapIncidents
      ? gaps?.filter((g) => {
          if (g.cause !== 'interrupted' || g.to != null) {
            return false;
          }
          const from = Date.parse(g.from);
          if (!Number.isFinite(from)) {
            return false;
          }
          return !journalHasOverlappingCrash(incidents ?? [], from, liveEdgeMs, liveEdgeMs);
        })
      : undefined;
  const rulesForMask =
    showScheduleMask && scheduleRules && scheduleRules.length > 0 ? scheduleRules : null;
  const maskSegs = rulesForMask
    ? sessions && sessions.length > 0
      ? buildScheduleMaskSegs(rulesForMask, sessions, pct)
      : scheduleVoidIntervals(rulesForMask, windowFromMs, windowToMs).map((v) => {
          const leftPct = pct(v.fromMs);
          return {
            leftPct,
            widthPct: pct(v.toMs) - leftPct,
            fromMs: v.fromMs,
            toMs: v.toMs,
          };
        })
    : [];
  const desiredSegs = rulesForMask
    ? sessions && sessions.length > 0
      ? buildScheduleDesiredSegs(rulesForMask, sessions, pct)
      : enumerateDesiredWindows(rulesForMask, windowFromMs, windowToMs).map((v) => {
          const leftPct = pct(v.fromMs);
          return {
            leftPct,
            widthPct: pct(v.toMs) - leftPct,
            fromMs: v.fromMs,
            toMs: v.toMs,
          };
        })
    : [];

  const breakBodies = journalPaint?.bodies.filter((b) => b.kind === 'break') ?? [];
  const crashBodies = journalPaint?.bodies.filter((b) => b.kind === 'crash') ?? [];

  return (
    <div
      className={[styles.track, showScheduleMask ? '' : styles.trackBare].filter(Boolean).join(' ')}
    >
      {desiredSegs.map((seg, i) =>
        seg.widthPct > 0 ? (
          <div
            key={`des${i}`}
            className={styles.scheduleDesiredBase}
            style={{ left: `${seg.leftPct}%`, width: `${seg.widthPct}%` }}
            {...bindTip(
              formatScheduleDesiredTooltip(seg.fromMs, seg.toMs, SCHEDULE_TZ_OFFSET_MIN),
              tip,
            )}
          />
        ) : null,
      )}

      {showNowMarker ? <span className={styles.nowLine} /> : null}

      {/* 1. link_liveness */}
      {showLinkRibbon
        ? (intervals ?? []).map((liv, i) => {
            const fromMs = Date.parse(liv.from);
            if (!Number.isFinite(fromMs)) return null;
            const toMs = livenessEndMs(liv, liveEdgeMs, windowToMs);
            if (!liv.open && toMs <= fromMs) return null;
            const left = pct(fromMs);
            const widthPct = pct(toMs) - left;
            if (widthPct <= 0) return null;
            const label = tipLabel(
              'Система подключена',
              tipRange(fromMs, toMs, liv.open, tzOffsetMin),
            );
            return (
              <div
                key={`c${i}`}
                className={[styles.bar, styles.connected, liv.open ? styles.live : '']
                  .filter(Boolean)
                  .join(' ')}
                style={{ left: `${left}%`, width: `${widthPct}%` }}
                {...bindTip(label, tip)}
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
              const label = tipLabel(
                greyLabel(gap.cause),
                tipRange(from, to, !gap.to, tzOffsetMin),
              );
              return (
                <div
                  key={`grey${i}`}
                  className={[styles.bar, styles.idle].join(' ')}
                  style={{ left: `${left}%`, width: `${Math.max(0.3, pct(to) - left)}%` }}
                  {...bindTip(label, tip)}
                />
              );
            })
        : null}

      {/* 2. break — journal (default) или gaps (paintGapsAsIncidents) */}
      {useJournalIncidents && showBreakIncidents
        ? breakBodies.map((body, i) => {
            const left = pct(body.fromMs);
            const open = body.toMs >= liveEdgeMs;
            const label = tipLabel(
              body.label,
              tipRange(body.fromMs, body.toMs, open, tzOffsetMin),
            );
            return (
              <div
                key={`ib${body.corrUid}-${i}`}
                className={[
                  styles.bar,
                  kindClass(body.kind),
                  open ? styles.incidentLive : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  left: `${left}%`,
                  width: `${Math.max(0.3, pct(body.toMs) - left)}%`,
                }}
                {...bindTip(label, tip)}
              />
            );
          })
        : null}

      {useGapIncidents
        ? gaps?.map((gap, i) => {
            if (GREY_CAUSES.has(gap.cause) || gap.cause === 'interrupted') {
              return null;
            }
            if (!isIncidentCause(gap.cause)) {
              return null;
            }
            const from = Date.parse(gap.from);
            const open = gap.to == null;
            const to = open ? liveEdgeMs : Date.parse(gap.to!);
            const left = pct(from);
            const label = tipLabel(
              'Восстановление связи',
              tipRange(from, to, open, tzOffsetMin),
            );
            return (
              <div
                key={`g${i}`}
                className={[
                  styles.bar,
                  styles.breakBar,
                  open ? styles.incidentLive : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ left: `${left}%`, width: `${Math.max(0.3, pct(to) - left)}%` }}
                {...bindTip(label, tip)}
              />
            );
          })
        : null}

      {/* 3. crash (поверх break) */}
      {useJournalIncidents && showCrashIncidents
        ? crashBodies.map((body, i) => {
            const left = pct(body.fromMs);
            const open = body.toMs >= liveEdgeMs;
            const label = tipLabel(
              body.label,
              tipRange(body.fromMs, body.toMs, open, tzOffsetMin),
            );
            return (
              <div
                key={`ic${body.corrUid}-${i}`}
                className={[
                  styles.bar,
                  kindClass(body.kind),
                  open ? styles.incidentLive : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  left: `${left}%`,
                  width: `${Math.max(0.3, pct(body.toMs) - left)}%`,
                }}
                {...bindTip(label, tip)}
              />
            );
          })
        : null}

      {showCrashIncidents
        ? optimisticCrashGaps?.map((gap, i) => {
            const from = Date.parse(gap.from);
            const open = gap.to == null;
            const to = open ? liveEdgeMs : Date.parse(gap.to!);
            const left = pct(from);
            const label = tipLabel(
              'Сервер недоступен',
              tipRange(from, to, open, tzOffsetMin),
            );
            return (
              <div
                key={`crash-gap${i}`}
                className={[
                  styles.bar,
                  styles.crashBar,
                  open ? styles.incidentLive : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ left: `${left}%`, width: `${Math.max(0.3, pct(to) - left)}%` }}
                {...bindTip(label, tip)}
              />
            );
          })
        : null}

      {useGapIncidents
        ? gaps?.map((gap, i) => {
            if (gap.cause !== 'interrupted') {
              return null;
            }
            const from = Date.parse(gap.from);
            const to = gap.to ? Date.parse(gap.to) : liveEdgeMs;
            const left = pct(from);
            const label = tipLabel(
              gapIncidentBodyLabel(gap.cause),
              tipRange(from, to, !gap.to, tzOffsetMin),
            );
            return (
              <div
                key={`gi${i}`}
                className={[styles.bar, gapIncidentBodyClass(gap.cause)].join(' ')}
                style={{ left: `${left}%`, width: `${Math.max(0.3, pct(to) - left)}%` }}
                {...bindTip(label, tip)}
              />
            );
          })
        : null}

      {/* 4. markers */}
      {useJournalIncidents
        ? journalPaint!.markers.map((m, i) => {
            const label = tipLabel(m.label, hhmm(m.atMs, tzOffsetMin));
            return m.kind === 'start' ? (
              <span
                key={`is${m.corrUid}-${i}`}
                className={styles.startMarker}
                style={{ left: `${pct(m.atMs)}%` }}
                {...bindTip(label, tip)}
              />
            ) : (
              <span
                key={`ir${m.corrUid}-${i}`}
                className={styles.recover}
                style={{ left: `${pct(m.atMs)}%` }}
                {...bindTip(label, tip)}
              />
            );
          })
        : null}

      {showCrashIncidents
        ? optimisticCrashGaps?.map((gap, i) => (
            <span
              key={`crash-s${i}`}
              className={styles.startMarker}
              style={{ left: `${pct(Date.parse(gap.from))}%` }}
              {...bindTip(
                tipLabel('Системный сбой', hhmm(Date.parse(gap.from), tzOffsetMin)),
                tip,
              )}
            />
          ))
        : null}

      {useGapIncidents
        ? gaps?.map((gap, i) => {
            if (!isIncidentCause(gap.cause)) {
              return null;
            }
            const from = Date.parse(gap.from);
            const startLabel =
              gap.cause === 'interrupted'
                ? tipLabel('Системный сбой', hhmm(from, tzOffsetMin))
                : tipLabel('Обрыв связи', hhmm(from, tzOffsetMin));
            return (
              <span
                key={`s${i}`}
                className={styles.startMarker}
                style={{ left: `${pct(from)}%` }}
                {...bindTip(startLabel, tip)}
              />
            );
          })
        : null}

      {useGapIncidents
        ? gaps?.map((gap, i) => {
            if (!gap.to || !isIncidentCause(gap.cause) || gap.abandoned) {
              return null;
            }
            const to = Date.parse(gap.to);
            const recoverLabel =
              gap.cause === 'interrupted'
                ? tipLabel('Система восстановлена', hhmm(to, tzOffsetMin))
                : tipLabel('Связь восстановлена', hhmm(to, tzOffsetMin));
            return (
              <span
                key={`r${i}`}
                className={styles.recover}
                style={{ left: `${pct(to)}%` }}
                {...bindTip(recoverLabel, tip)}
              />
            );
          })
        : null}

      {/* 5. schedule void mask */}
      {maskSegs.map((seg, i) => {
        if (seg.widthPct <= 0) return null;
        return (
          <div
            key={`void${i}`}
            className={styles.scheduleMask}
            style={{ left: `${seg.leftPct}%`, width: `${seg.widthPct}%` }}
            {...bindTip(
              formatScheduleIdleTooltip(seg.fromMs, seg.toMs, SCHEDULE_TZ_OFFSET_MIN),
              tip,
            )}
          />
        );
      })}
    </div>
  );
});
