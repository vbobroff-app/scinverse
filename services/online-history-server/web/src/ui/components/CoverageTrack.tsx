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
}

const MSK_MS = 3 * 60 * 60 * 1000;

/** Момент в МСК как `dd.MM HH:mm` (для нативного title колбаски). */
function mskStamp(iso: string): string {
  const d = new Date(Date.parse(iso) + MSK_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/**
 * Одна дорожка Ганта (колбаски одного инструмента) на div-ах. «Ползущий» правый край открытой
 * сессии и now-линия управляются CSS-переменной `--now-pct` (ставится на скролл-контейнере),
 * поэтому тик времени не ре-рендерит строки — компонент мемоизирован.
 */
export const CoverageTrack = memo(function CoverageTrack({ window, segments, sourceCodeById, sessions }: Props) {
  const pct = makeProjector(Date.parse(window.from), Date.parse(window.to), sessions);
  // При большом числе сессий (M/Q/Y) не рисуем поштучные слоты/швы — было бы шумно и тяжело.
  const showSessionDetail = !!sessions && sessions.length > 1 && sessions.length <= 40;

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

      <span className={styles.nowLine} />

      {showSessionDetail &&
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

        const rangeText = `${mskStamp(seg.from)} — ${open ? 'сейчас' : mskStamp(seg.to as string)}`;
        const gapsText = seg.gaps.length > 0 ? ` · разрывов: ${seg.gaps.length}` : '';

        return (
          <div
            key={seg.segmentId}
            className={[styles.bar, open ? styles.live : ''].filter(Boolean).join(' ')}
            style={style}
            title={`${rangeText} · ${seg.status} · сделок: ${seg.tradeCount}${gapsText} (МСК)`}
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
              title={`разрыв: ${mskStamp(g.from)} — ${mskStamp(g.to)} (МСК)`}
            />
          );
        }),
      )}
    </div>
  );
});
