import { memo } from 'react';
import type { CoverageWindow } from '../../core/OhsStore';
import type { CoverageSegmentDto, SessionDto } from '../../core/types';
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
  sessions?: SessionDto[];
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
  sessions,
  highlightDays,
}: Props) {
  const pct = makeProjector(Date.parse(window.from), Date.parse(window.to), sessions);
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

      {/* Подложка: намерение/покрытие записи (тёмная, до now). Честность по связи — phase 7h. */}
      {segments.map((seg) => {
        const left = pct(Date.parse(seg.from));
        const open = seg.to === null;

        const style = open
          ? { left: `${left}%`, right: 'calc(100% - var(--now-pct, 100) * 1%)' }
          : { left: `${left}%`, width: `${Math.max(0.4, pct(Date.parse(seg.to as string)) - left)}%` };

        return (
          <div
            key={seg.segmentId}
            className={[styles.bar, open ? styles.live : ''].filter(Boolean).join(' ')}
            style={style}
            title="В записи (покрытие). Была ли торговля — по ярким ячейкам сделок."
          />
        );
      })}

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
