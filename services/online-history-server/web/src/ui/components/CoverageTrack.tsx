import { memo, type ReactNode } from 'react';
import type { CoverageWindow } from '../../core/OhsStore';
import {
  effectiveSegmentEndMs,
  gapIntersectsSegment,
  intersectMs,
  intentSpanForGaps,
  isBreakGap,
  livenessEndMs,
  resolveGapEndMs,
} from '../../core/coverageGeometry';
import type { CaptureGapDto, CoverageSegmentDto, LivenessIntervalDto, SessionDto } from '../../core/types';
import { colorForSourceCode } from '../../core/sourceColors';
import { makeProjector } from '../../core/sessionProjection';
import styles from './CoverageTrack.module.css';

interface Props {
  window: CoverageWindow;
  segments: CoverageSegmentDto[];
  sourceCodeById: Map<number, string>;
  /** Слой сделок: старты непустых бакетов (ms), выровнены к шагу `activityBucketMs`. */
  activityBuckets?: number[];
  /** Шаг бакета слоя сделок (ms) — ширина ячейки во времени. */
  activityBucketMs?: number;
  /** Источник слоя сделок (для цвета ярких ячеек) — `sourceId` провайдера дорожки. */
  activitySourceId?: number;
  /** Смещение отображаемого ТЗ от UTC (мин) — для подписи времени в тултипах ячеек. */
  tzOffsetMin?: number;
  /** Интервалы живости захвата (source) — честная подложка = намерение ∩ живость. */
  livenessIntervals?: LivenessIntervalDto[];
  /** Журнал разрывов захвата (красная разметка). */
  captureGaps?: CaptureGapDto[];
  sessions?: SessionDto[];
  /** Текущее время (ms) — правый край открытой живости и открытого намерения. */
  nowMs?: number;
  /** Подсветка дней: каждый день обрамляется рамкой + скруглением (тумблер в Ганте). */
  highlightDays?: boolean;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** `HH:MM` в заданном ТЗ (для тултипа бакета слоя сделок). */
function hhmm(ms: number, offMin: number): string {
  const d = new Date(ms + offMin * 60_000);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

const GAP_CAUSE_LABEL: Record<string, string> = {
  server_down: 'Обрыв связи',
  ping_failed: 'Связь потеряна (пинг)',
  interrupted: 'Прервано (краш/рестарт)',
};

const SEGMENT_STATUS_LABEL: Record<string, string> = {
  recording: 'Запись',
  stopped: 'Остановлено вручную',
  disconnected: 'Обрыв связи',
  error: 'Ошибка соединения',
  interrupted: 'Прервано (краш/рестарт)',
};

const BREAK_SEGMENT_STATUSES = new Set(['disconnected', 'error', 'interrupted']);

/** Подложка «стояло на запись» по границам сегмента намерения. */
function intentBar(
  seg: CoverageSegmentDto,
  segFrom: number,
  segTo: number,
  open: boolean,
  pct: (ms: number) => number,
  live: boolean,
  dim = false,
): ReactNode {
  const left = pct(segFrom);
  const style = open
    ? { left: `${left}%`, right: 'calc(100% - var(--now-pct, 100) * 1%)' }
    : { left: `${left}%`, width: `${Math.max(0.4, pct(segTo) - left)}%` };
  const statusLabel = SEGMENT_STATUS_LABEL[seg.status] ?? seg.status;
  const stopped = seg.status === 'stopped';
  return (
    <div
      key={`${seg.segmentId}${dim ? '-intent' : ''}`}
      className={[
        styles.bar,
        dim ? styles.barIntent : '',
        stopped ? styles.barStopped : '',
        live ? styles.live : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      title={
        dim
          ? `${statusLabel} · намерение записи`
          : `${statusLabel} · в записи. Торговля — по ярким ячейкам.`
      }
    />
  );
}

/**
 * Одна дорожка Ганта (колбаски одного инструмента) на div-ах. «Ползущий» правый край открытой
 * сессии и now-линия управляются CSS-переменной `--now-pct` (ставится на скролл-контейнере),
 * поэтому тик времени не ре-рендерит строки — компонент мемоизирован.
 *
 * Вертикальный time-line ведётся на уровне всей области Ганта (`InstrumentPicker`), не здесь.
 */
export const CoverageTrack = memo(function CoverageTrack({
  window,
  segments,
  sourceCodeById,
  activityBuckets,
  activityBucketMs,
  activitySourceId,
  tzOffsetMin = 180,
  livenessIntervals,
  captureGaps,
  sessions,
  highlightDays,
  nowMs,
}: Props) {
  const windowFromMs = Date.parse(window.from);
  const windowToMs = Date.parse(window.to);
  const liveEdgeMs = Math.min(nowMs ?? windowToMs, windowToMs);
  const pct = makeProjector(windowFromMs, windowToMs, sessions);
  const honestMode = (livenessIntervals?.length ?? 0) > 0;
  const intentSpan = honestMode
    ? intentSpanForGaps(segments, livenessIntervals, liveEdgeMs, windowToMs)
    : null;
  // При большом числе сессий (M/Q/Y) не рисуем поштучные слоты/швы — было бы шумно и тяжело.
  const showSessionDetail = !!sessions && sessions.length > 1 && sessions.length <= 40;
  // Контейнер дня рисуем во всех посессионных режимах (D/W), но не для длинных окон.
  const showDays = !!sessions && sessions.length <= 40;

  return (
    <div className={styles.track}>
      {showSessionDetail &&
        sessions!.map((s) =>
          s.weekend ? (
            <span
              key={`wk${s.date}`}
              className={styles.weekendSlot}
              style={{
                left: `${pct(Date.parse(s.start))}%`,
                width: `${Math.max(0, pct(Date.parse(s.end)) - pct(Date.parse(s.start)))}%`,
              }}
            />
          ) : null,
        )}

      {showDays &&
        sessions!.map((s) => {
          const dayL = pct(Date.parse(s.start));
          const dayR = pct(Date.parse(s.end));
          const w = Math.max(0.0001, dayR - dayL);
          const hasZones = !!s.sessionStart && !!s.sessionEnd;
          // Доли зон [pre | session | post] внутри контейнера дня (0..100%).
          const preW = hasZones ? ((pct(Date.parse(s.sessionStart!)) - dayL) / w) * 100 : 0;
          const postL = hasZones ? ((pct(Date.parse(s.sessionEnd!)) - dayL) / w) * 100 : 100;
          return (
            <div
              key={`day${s.date}`}
              className={[styles.dayBox, highlightDays ? styles.dayBoxOn : ''].filter(Boolean).join(' ')}
              style={{ left: `${dayL}%`, width: `${w}%` }}
            >
              {hasZones && (
                <>
                  <span className={styles.zonePre} style={{ left: 0, width: `${Math.max(0, preW)}%` }} />
                  <span className={styles.zoneSession} style={{ left: `${preW}%`, width: `${Math.max(0, postL - preW)}%` }} />
                  <span className={styles.zonePost} style={{ left: `${postL}%`, right: 0 }} />
                </>
              )}
            </div>
          );
        })}

      <span className={styles.nowLine} />

      {showSessionDetail &&
        !highlightDays &&
        sessions!.map((s, i) =>
          i === 0 ? null : (
            <span key={s.date} className={styles.sessionSep} style={{ left: `${pct(Date.parse(s.start))}%` }} />
          ),
        )}

      {/* Подложка: намерение ∩ живость (phase 7h). */}
      {segments.flatMap((seg) => {
        const segFrom = Date.parse(seg.from);
        const segTo = effectiveSegmentEndMs(seg, livenessIntervals, liveEdgeMs, windowToMs);
        const open = seg.to === null;

        if (!honestMode) {
          return [intentBar(seg, segFrom, segTo, open, pct, open && seg.status !== 'stopped')];
        }

        const bars: ReactNode[] = [intentBar(seg, segFrom, segTo, open, pct, false, true)];
        for (let i = 0; i < (livenessIntervals?.length ?? 0); i++) {
          const liv = livenessIntervals![i];
          const livTo = livenessEndMs(liv, liveEdgeMs, windowToMs);
          const inter = intersectMs(segFrom, segTo, Date.parse(liv.from), livTo);
          if (!inter) continue;
          const left = pct(inter.from);
          const stopped = seg.status === 'stopped';
          bars.push(
            <div
              key={`${seg.segmentId}-liv-${i}`}
              className={[
                styles.bar,
                stopped ? styles.barStopped : '',
                open && liv.open ? styles.live : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ left: `${left}%`, width: `${Math.max(0.4, pct(inter.to) - left)}%` }}
              title="Захват жив (связь ok)"
            />,
          );
        }
        if (!open && BREAK_SEGMENT_STATUSES.has(seg.status)) {
          const seamLeft = pct(segTo);
          bars.push(
            <span
              key={`${seg.segmentId}-seam`}
              className={styles.breakSeam}
              style={{ left: `${seamLeft}%` }}
              title={`${SEGMENT_STATUS_LABEL[seg.status] ?? seg.status} · ${hhmm(segTo, tzOffsetMin)}`}
            />,
          );
        }
        return bars;
      })}

      {/* Разрывы захвата (красная штриховка) внутри намерения записи. */}
      {honestMode &&
        intentSpan &&
        (() => {
          const gaps: ReactNode[] = [];
          for (let i = 0; i < (captureGaps?.length ?? 0); i++) {
            const gap = captureGaps![i];
            if (!isBreakGap(gap)) continue;

            const gapEnd = resolveGapEndMs(gap, livenessIntervals, liveEdgeMs, windowToMs);
            if (gapEnd === null) continue;

            const inter = gapIntersectsSegment(intentSpan.from, intentSpan.to, Date.parse(gap.from), gapEnd);
            if (!inter) continue;

            const left = pct(inter.from);
            const label = GAP_CAUSE_LABEL[gap.cause] ?? gap.cause;
            gaps.push(
              <div
                key={`gap-${i}`}
                className={styles.captureGap}
                style={{ left: `${left}%`, width: `${Math.max(0.4, pct(inter.to) - left)}%` }}
                title={`${label} · ${hhmm(inter.from, tzOffsetMin)}–${hhmm(inter.to, tzOffsetMin)}`}
              />,
            );
          }
          return gaps;
        })()}

      {/* Слой сделок: яркие ячейки непустых бакетов поверх подложки (была торговля = есть ячейка). */}
      {activityBuckets && activityBucketMs
        ? (() => {
            const color = colorForSourceCode(sourceCodeById.get(activitySourceId ?? -1));
            return activityBuckets.map((b) => {
              const cellLeft = pct(b);
              const cellWidth = Math.max(0.25, pct(b + activityBucketMs) - cellLeft);
              return (
                <span
                  key={b}
                  className={styles.trade}
                  style={{ left: `${cellLeft}%`, width: `${cellWidth}%`, background: color }}
                  title={`Торговля была · ${hhmm(b, tzOffsetMin)}–${hhmm(b + activityBucketMs, tzOffsetMin)}`}
                />
              );
            });
          })()
        : null}
    </div>
  );
});
