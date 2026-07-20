import { useState } from 'react';
import styles from './WeeklyDayColumns.module.css';

const AXIS_MIN = 48 * 60;
const DAY_MIN = 24 * 60;

/** Эффективное окно одного дня после наложения слоёв. */
export interface DayColumnSeg {
  mode: 'window' | 'off';
  startMin: number;
  endMin: number;
  /** День входит в текущий редактируемый скоуп (солидарное движение). */
  active: boolean;
  baseStartMin?: number | null;
  baseEndMin?: number | null;
  /** Неторговый день (подсветка подписи). */
  nonTrading?: boolean;
}

export interface DayColumn {
  key: string;
  label: string;
  seg: DayColumnSeg;
}

export interface WeeklyDayColumnsProps {
  columns: DayColumn[];
  /** Заголовок секции. */
  title?: string;
  /** Раскрыт ли график при первом рендере. */
  defaultExpanded?: boolean;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function pct(absMin: number): number {
  return clamp((absMin / AXIS_MIN) * 100, 0, 100);
}

/**
 * Просмотр окна по колонкам дней (неделя или даты).
 * Y снизу вверх: 00:00 → +48h. Сегмент = open + duration (уже resolved по слоям).
 * Заголовок сворачивает/разворачивает график.
 */
export function WeeklyDayColumns({
  columns,
  title = 'Неделя',
  defaultExpanded = true,
}: WeeklyDayColumnsProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const dense = columns.length > 7;

  return (
    <section className={styles.root} aria-label={`${title} — просмотр окна`}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={expanded}
        onClick={() => setExpanded((o) => !o)}
      >
        <span className={[styles.chevron, expanded ? styles.chevronOpen : ''].filter(Boolean).join(' ')}>
          ▸
        </span>
        <span className={styles.title}>{title}</span>
        {!expanded && <span className={styles.hint}>график</span>}
      </button>
      {expanded && (
        <div className={styles.chart} role="img" aria-label="Вертикальные окна по дням">
          <div className={styles.axisHint} aria-hidden="true">
            <span>+48ч</span>
            <span>+24ч</span>
            <span>00:00</span>
          </div>
          <div className={[styles.cols, dense ? styles.colsDense : ''].filter(Boolean).join(' ')}>
            {columns.map((col) => {
              const seg = col.seg;
              const span = Math.max(0, seg.endMin - seg.startMin);
              const bottomPct = pct(seg.startMin);
              const heightPct = clamp((span / AXIS_MIN) * 100, 0, 100 - bottomPct);
              const showBase =
                seg.mode === 'window' &&
                seg.baseStartMin != null &&
                seg.baseEndMin != null &&
                span > 0;
              const baseLo = showBase ? Math.max(seg.baseStartMin!, seg.startMin) : 0;
              const baseHi = showBase ? Math.min(seg.baseEndMin!, seg.endMin) : 0;
              const baseOk = showBase && baseHi > baseLo;
              const baseBottomRel = baseOk ? clamp(((baseLo - seg.startMin) / span) * 100, 0, 100) : 0;
              const baseHeightRel = baseOk
                ? clamp(((baseHi - baseLo) / span) * 100, 0, 100 - baseBottomRel)
                : 0;

              return (
                <div
                  key={col.key}
                  className={[styles.col, seg.active ? styles.colOn : styles.colOff].join(' ')}
                >
                  <div className={[styles.track, dense ? styles.trackDense : ''].filter(Boolean).join(' ')}>
                    <span className={styles.midLine} aria-hidden="true" />
                    {seg.mode === 'window' && heightPct > 0 && (
                      <div
                        className={styles.seg}
                        style={{ bottom: `${bottomPct}%`, height: `${heightPct}%` }}
                      >
                        {baseOk && (
                          <span
                            className={styles.segBase}
                            style={{ bottom: `${baseBottomRel}%`, height: `${baseHeightRel}%` }}
                            aria-hidden="true"
                          />
                        )}
                      </div>
                    )}
                    {seg.mode === 'off' && (
                      <div
                        className={styles.segOff}
                        style={{ bottom: '0%', height: `${(DAY_MIN / AXIS_MIN) * 100}%` }}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  <span
                    className={[styles.label, seg.nonTrading ? styles.labelNonTrading : '']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {col.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
