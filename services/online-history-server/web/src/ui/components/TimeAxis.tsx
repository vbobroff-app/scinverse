import { useMemo } from 'react';
import type { CoverageWindow } from '../../core/OhsStore';
import type { SessionDto } from '../../core/types';
import { tzDateOf } from '../../core/moexSession';
import { makeProjector } from '../../core/sessionProjection';
import { useElementWidth } from '../hooks/useElementWidth';
import styles from './TimeAxis.module.css';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Минимум пикселей на подпись (dd.MM / HH:mm / «мон YY») — чтобы не сливались. */
const MIN_LABEL_PX = 56;
/** «Красивые» шаги прореживания по индексу сессии. */
const SESSION_STRIDES = [1, 2, 3, 5, 7, 10, 14, 20, 30, 45, 60, 90, 120, 180, 250, 365];
/** «Красивые» шаги для часовой шкалы (D1). */
const HOUR_STEPS = [1, 2, 3, 4, 6, 8, 12];

interface Props {
  window: CoverageWindow;
  sessions?: SessionDto[];
  /** Смещение стандарта времени отображения от UTC, минуты (МСК = +180). */
  tzOffsetMin: number;
}

type Edge = 'start' | 'end' | undefined;
interface Mark {
  left: number;
  label: string;
  edge?: Edge;
  weekend?: boolean;
}

function pctFn(fromMs: number, span: number) {
  return (t: number) => Math.min(100, Math.max(0, ((t - fromMs) / span) * 100));
}

/** Время как HH:mm в заданном ТЗ. */
function hmTz(ms: number, offMin: number): string {
  const d = new Date(ms + offMin * 60_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** Дата как dd.MM в заданном ТЗ. */
function dmTz(ms: number, offMin: number): string {
  const d = tzDateOf(ms, offMin);
  return `${String(d.day).padStart(2, '0')}.${String(d.month).padStart(2, '0')}`;
}

function dmIso(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
}

function dmyIso(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y.slice(2)}`;
}

/** Инстант полуночи (в заданном ТЗ) для даты момента `ms`. */
function midnightTz(ms: number, offMin: number): number {
  const d = tzDateOf(ms, offMin);
  return Date.UTC(d.year, d.month - 1, d.day, 0, 0) - offMin * 60_000;
}

/** ISO `yyyy-MM-dd` для момента в заданном ТЗ (для форматирования с годом). */
function isoTz(ms: number, offMin: number): string {
  const d = tzDateOf(ms, offMin);
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

/** Наименьший «красивый» шаг, дающий не больше `maxCount` меток. */
function pickStride(total: number, maxCount: number, steps: number[]): number {
  for (const s of steps) {
    if (Math.ceil(total / s) <= maxCount) return s;
  }
  return steps[steps.length - 1];
}

export function TimeAxis({ window, sessions, tzOffsetMin }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const fromMs = Date.parse(window.from);
  const toMs = Date.parse(window.to);
  const span = Math.max(1, toMs - fromMs);

  const marks = useMemo<Mark[]>(() => {
    const maxLabels = Math.max(2, Math.floor((width || 600) / MIN_LABEL_PX));
    const p = pctFn(fromMs, span);
    const n = sessions?.length ?? 0;

    // Посессионная шкала (D/W/M/Q/Y): подписи прорежены по ширине, шаг — по индексу сессии.
    if (sessions && n > 1) {
      const proj = makeProjector(fromMs, toMs, sessions);
      const spanDays = span / DAY_MS;
      const withYear = spanDays > 300;
      const stride = pickStride(n, maxLabels, SESSION_STRIDES);
      const out: Mark[] = [];
      for (let i = 0; i < n; i += stride) {
        const s = sessions[i];
        const center = (Date.parse(s.start) + Date.parse(s.end)) / 2;
        out.push({
          left: proj(center),
          label: withYear ? dmyIso(s.date) : dmIso(s.date),
          weekend: s.weekend,
        });
      }
      return out;
    }

    const spanH = span / HOUR_MS;

    // Одна сессия / короткое окно (D1): время начала, конца и круглые часы между.
    if (spanH <= 36) {
      const baseStep = spanH <= 4 ? 1 : spanH <= 10 ? 2 : 3;
      const stepH = pickStride(spanH / baseStep, maxLabels, HOUR_STEPS) * baseStep;
      const mid = midnightTz(fromMs, tzOffsetMin);
      const pad = span * 0.04;
      const inner: Mark[] = [];
      for (let h = 0; h <= 48; h += stepH) {
        const t = mid + h * HOUR_MS;
        if (t > fromMs + pad && t < toMs - pad) {
          inner.push({ left: p(t), label: hmTz(t, tzOffsetMin) });
        }
      }
      return [
        { left: 0, label: hmTz(fromMs, tzOffsetMin), edge: 'start' },
        ...inner,
        { left: 100, label: hmTz(toMs, tzOffsetMin), edge: 'end' },
      ];
    }

    // Длинное окно без сессий (All/диапазон): круглые даты, шаг по ширине.
    const days = spanH / 24;
    const stepD = pickStride(days, maxLabels, SESSION_STRIDES);
    const withYear = days > 300;
    const pad = span * 0.02;
    const inner: Mark[] = [];
    for (let t = midnightTz(fromMs, tzOffsetMin) + stepD * DAY_MS; t < toMs - pad; t += stepD * DAY_MS) {
      if (t > fromMs + pad) {
        inner.push({ left: p(t), label: withYear ? dmyIso(isoTz(t, tzOffsetMin)) : dmTz(t, tzOffsetMin) });
      }
    }
    return [
      { left: 0, label: dmTz(fromMs, tzOffsetMin), edge: 'start' },
      ...inner,
      { left: 100, label: dmTz(toMs, tzOffsetMin), edge: 'end' },
    ];
  }, [fromMs, toMs, span, sessions, width, tzOffsetMin]);

  return (
    <div className={styles.axis} ref={ref}>
      {marks.map((m, i) => {
        const edge = m.edge ?? (m.left < 4 ? 'start' : m.left > 96 ? 'end' : undefined);
        return (
        <span
          key={`m${i}`}
          className={[
            styles.mark,
            edge === 'start' ? styles.markStart : '',
            edge === 'end' ? styles.markEnd : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ left: `${m.left}%` }}
        >
          <span className={styles.tickMark} />
          <span className={[styles.label, m.weekend ? styles.weekend : ''].filter(Boolean).join(' ')}>
            {m.label}
          </span>
        </span>
        );
      })}
    </div>
  );
}
