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
  sessions?: SessionDto[];
  /** Подсветка дней: каждый день обрамляется рамкой + скруглением (тумблер в Ганте). */
  highlightDays?: boolean;
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

      {segments.map((seg) => {
        const color = colorForSourceCode(sourceCodeById.get(seg.sourceId));
        const left = pct(Date.parse(seg.from));
        const open = seg.to === null;

        const style = open
          ? { left: `${left}%`, right: 'calc(100% - var(--now-pct, 100) * 1%)', background: color }
          : { left: `${left}%`, width: `${Math.max(0.4, pct(Date.parse(seg.to as string)) - left)}%`, background: color };

        return (
          <div
            key={seg.segmentId}
            className={[styles.bar, open ? styles.live : ''].filter(Boolean).join(' ')}
            style={style}
          />
        );
      })}

      {segments.flatMap((seg) =>
        seg.gaps.map((g, i) => {
          const gapLeft = pct(Date.parse(g.from));
          const gapWidth = Math.max(0.3, pct(Date.parse(g.to)) - gapLeft);
          return (
            <span
              key={`${seg.segmentId}-gap-${i}`}
              className={styles.gap}
              style={{ left: `${gapLeft}%`, width: `${gapWidth}%` }}
            />
          );
        }),
      )}
    </div>
  );
});
