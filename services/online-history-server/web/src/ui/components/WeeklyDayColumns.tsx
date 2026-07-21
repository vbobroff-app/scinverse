import { useState } from 'react';
import { Tip } from '@scinverse/notification-center';
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
  /** Подпись слоя в тултипе колбаски (напр. «Все», «Будни»). */
  layerLabel?: string;
}

export interface DayColumn {
  key: string;
  label: string;
  /** Кастомный тултип подписи (напр. дата с годом в calendar-режиме). */
  labelTip?: string;
  seg: DayColumnSeg;
}

export interface WeeklyDayColumnsProps {
  columns: DayColumn[];
  /** Заголовок секции. */
  title?: string;
  /** Раскрыт ли график при первом рендере. */
  defaultExpanded?: boolean;
  /** Клик по колбаске — выбрать слой дня. */
  onSegClick?: (key: string) => void;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function pct(absMin: number): number {
  return clamp((absMin / AXIS_MIN) * 100, 0, 100);
}

/** Минуты оси → HH:mm в пределах суток (как на ленте). */
function fmtHm(totalMin: number): string {
  const norm = ((totalMin % 1440) + 1440) % 1440;
  return `${String(Math.floor(norm / 60)).padStart(2, '0')}:${String(norm % 60).padStart(2, '0')}`;
}

function windowTip(seg: DayColumnSeg): string | undefined {
  const head = seg.layerLabel ? `${seg.layerLabel} · ` : '';
  if (seg.mode === 'off') return `${head}выкл`;
  if (seg.endMin <= seg.startMin) return undefined;
  return `${head}${fmtHm(seg.startMin)}–${fmtHm(seg.endMin)}`;
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
  onSegClick,
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
          <div
            className={[styles.cols, dense ? styles.colsDense : ''].filter(Boolean).join(' ')}
            style={{ gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(0, 1fr))` }}
          >
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
              const tip = windowTip(seg);
              const clickable = onSegClick != null && (seg.mode === 'off' || heightPct > 0);

              return (
                <div
                  key={col.key}
                  className={[styles.col, seg.active ? styles.colOn : styles.colOff].join(' ')}
                >
                  <div className={[styles.track, dense ? styles.trackDense : ''].filter(Boolean).join(' ')}>
                    <span className={styles.midLine} aria-hidden="true" />
                    {seg.mode === 'window' && heightPct > 0 && (
                      <div
                        className={[styles.seg, clickable ? styles.segClickable : '']
                          .filter(Boolean)
                          .join(' ')}
                        style={{ bottom: `${bottomPct}%`, height: `${heightPct}%` }}
                        role={clickable ? 'button' : undefined}
                        tabIndex={clickable ? 0 : undefined}
                        onClick={clickable ? () => onSegClick(col.key) : undefined}
                        onKeyDown={
                          clickable
                            ? (e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  onSegClick(col.key);
                                }
                              }
                            : undefined
                        }
                      >
                        <Tip content={tip} block>
                          <span className={styles.segHit} />
                        </Tip>
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
                        className={[styles.segOff, clickable ? styles.segClickable : '']
                          .filter(Boolean)
                          .join(' ')}
                        style={{ bottom: '0%', height: `${(DAY_MIN / AXIS_MIN) * 100}%` }}
                        role={clickable ? 'button' : undefined}
                        tabIndex={clickable ? 0 : undefined}
                        onClick={clickable ? () => onSegClick(col.key) : undefined}
                        onKeyDown={
                          clickable
                            ? (e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  onSegClick(col.key);
                                }
                              }
                            : undefined
                        }
                      >
                        <Tip content={tip} block>
                          <span className={styles.segHit} />
                        </Tip>
                      </div>
                    )}
                  </div>
                  <Tip content={col.labelTip}>
                    <span
                      className={[styles.label, seg.nonTrading ? styles.labelNonTrading : '']
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {col.label}
                    </span>
                  </Tip>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
