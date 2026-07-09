import { memo } from 'react';
import type { CoverageWindow } from '../../core/OhsStore';
import type { CoverageSegmentDto } from '../../core/types';
import { colorForSourceCode } from '../../core/sourceColors';
import styles from './CoverageTrack.module.css';

interface Props {
  window: CoverageWindow;
  segments: CoverageSegmentDto[];
  sourceCodeById: Map<number, string>;
}

/**
 * Одна дорожка Ганта (колбаски одного инструмента) на div-ах. «Ползущий» правый край открытой
 * сессии и now-линия управляются CSS-переменной `--now-pct` (ставится на скролл-контейнере),
 * поэтому тик времени не ре-рендерит строки — компонент мемоизирован.
 */
export const CoverageTrack = memo(function CoverageTrack({ window, segments, sourceCodeById }: Props) {
  const fromMs = Date.parse(window.from);
  const toMs = Date.parse(window.to);
  const span = Math.max(1, toMs - fromMs);
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - fromMs) / span) * 100));

  return (
    <div className={styles.track}>
      <span className={styles.nowLine} />

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
            title={`${seg.status} · сделок: ${seg.tradeCount}`}
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
