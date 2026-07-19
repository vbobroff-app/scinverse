import { useEffect, useMemo, useState } from 'react';
import { MONTHS_RU, MonthGrid } from './MonthGrid';
import styles from './StaticExceptionCalendar.module.css';

export interface StaticExcRange {
  from: string;
  to: string;
  mode: 'window' | 'off';
}

interface Props {
  /** Уже созданные static-исключения (мертвые блоки на сетке). */
  exceptions: readonly StaticExcRange[];
  /** Текущий активный скоуп (подсветка выбора). */
  activeFrom?: string;
  activeTo?: string;
  maxSpanDays?: number;
  /** Неторговые дни биржи (красный текст). */
  isNonTrading?: (iso: string) => boolean;
  onViewChange?: (year: number, month: number) => void;
  /** Перейти к выбранной дате/диапазону (новый или существующий). */
  onGo: (from: string, to: string) => void;
  /** Сбросить все static-исключения. */
  onClearAll: () => void;
}

function spanDays(a: string, b: string): number {
  const ms = Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`);
  return Math.round(ms / 86_400_000) + 1;
}

function addDaysIso(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function rangesOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  return aFrom <= bTo && bFrom <= aTo;
}

function findCovering(iso: string, exceptions: readonly StaticExcRange[]): StaticExcRange | undefined {
  return exceptions.find((e) => iso >= e.from && iso <= e.to);
}

function overlapsAny(from: string, to: string, exceptions: readonly StaticExcRange[]): boolean {
  return exceptions.some((e) => rangesOverlap(from, to, e.from, e.to));
}

/**
 * Календарь static-исключений расписания соединения.
 * Существующие диапазоны — приглушённые блоки (off — красная рамка); клик по ним выбирает для «Перейти».
 * Новый диапазон — только в свободных днях, без пересечений; макс. длина — maxSpanDays.
 */
export function StaticExceptionCalendar({
  exceptions,
  activeFrom,
  activeTo,
  maxSpanDays = 14,
  isNonTrading,
  onViewChange,
  onGo,
  onClearAll,
}: Props) {
  const today = new Date();
  const initial = activeFrom ? new Date(`${activeFrom}T12:00:00`) : today;

  const [view, setView] = useState({ year: initial.getFullYear(), month: initial.getMonth() });
  const [start, setStart] = useState<string | undefined>(activeFrom);
  const [end, setEnd] = useState<string | undefined>(activeTo ?? activeFrom);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    onViewChange?.(view.year, view.month);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onViewChange
  }, [view.year, view.month]);

  // Синхронизация при смене активного скоупа снаружи.
  useEffect(() => {
    setStart(activeFrom);
    setEnd(activeTo ?? activeFrom);
  }, [activeFrom, activeTo]);

  const coveringMap = useMemo(() => {
    const map = new Map<string, StaticExcRange>();
    for (const e of exceptions) {
      let cur = e.from;
      while (cur <= e.to) {
        map.set(cur, e);
        cur = addDaysIso(cur, 1);
        if (map.size > 400) break;
      }
    }
    return map;
  }, [exceptions]);

  const pick = (value: string) => {
    setHint(null);
    const covering = findCovering(value, exceptions);
    // Клик по существующему исключению — выбрать целиком для «Перейти».
    if (covering) {
      setStart(covering.from);
      setEnd(covering.to);
      return;
    }

    // Новый выбор только на свободных днях.
    if (!start || (start && end)) {
      setStart(value);
      setEnd(undefined);
      return;
    }

    let lo = value < start ? value : start;
    let hi = value < start ? start : value;
    if (spanDays(lo, hi) > maxSpanDays) {
      hi = addDaysIso(lo, maxSpanDays - 1);
      setHint(`макс. ${maxSpanDays} дн.`);
    }
    if (overlapsAny(lo, hi, exceptions)) {
      setHint('пересечение с исключением');
      return;
    }
    setStart(lo);
    setEnd(hi);
  };

  const shiftMonth = (delta: number) => {
    const base = new Date(view.year, view.month + delta, 1);
    setView({ year: base.getFullYear(), month: base.getMonth() });
  };

  const goToday = () => setView({ year: today.getFullYear(), month: today.getMonth() });

  const reset = () => {
    setStart(undefined);
    setEnd(undefined);
    setHint(null);
    onClearAll();
  };

  const go = () => {
    if (!start) return;
    const to = end ?? start;
    // Новый диапазон не должен пересекать чужие (существующий — ок).
    const exact = exceptions.some((e) => e.from === start && e.to === to);
    if (!exact && overlapsAny(start, to, exceptions)) {
      setHint('пересечение с исключением');
      return;
    }
    onGo(start, to);
  };

  const inDraft = (value: string) =>
    start !== undefined && end !== undefined && value >= start && value <= end;

  const isEdge = (value: string) => value === start || (end != null && value === end);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <button type="button" className={styles.link} onClick={reset} tabIndex={-1} title="Сбросить все static-исключения">
          Сбросить
        </button>
        <button type="button" className={styles.link} onClick={goToday} tabIndex={-1}>
          Сегодня
        </button>
      </div>

      <div className={styles.nav}>
        <button type="button" className={styles.navBtn} onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц">
          ‹
        </button>
        <span className={styles.navTitle}>
          {MONTHS_RU[view.month]} {view.year}
        </span>
        <button type="button" className={styles.navBtn} onClick={() => shiftMonth(1)} aria-label="Следующий месяц">
          ›
        </button>
      </div>

      <MonthGrid
        year={view.year}
        month={view.month}
        classes={{ weekdays: styles.weekdays, weekday: styles.weekday, grid: styles.cells, empty: styles.empty }}
        renderDay={(value) => {
          const exc = coveringMap.get(value);
          const draft = inDraft(value);
          const edge = isEdge(value);
          const locked = exc != null && !draft;
          const offExc = exc?.mode === 'off';
          const draftOff = draft && start && (end ?? start) && exceptions.some(
            (e) => e.from === start && e.to === (end ?? start) && e.mode === 'off',
          );

          return (
            <button
              key={value}
              type="button"
              className={[
                styles.cell,
                edge ? styles.cellEdge : '',
                draft && !edge ? styles.cellInRange : '',
                locked ? styles.cellLocked : '',
                locked && offExc ? styles.cellLockedOff : '',
                draft && (offExc || draftOff) ? styles.cellEdgeOff : '',
                isNonTrading?.(value) ? styles.cellNonTrading : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => pick(value)}
              title={
                exc
                  ? exc.mode === 'off'
                    ? `Static · выкл · ${exc.from.slice(8)}.${exc.from.slice(5, 7)}–${exc.to.slice(8)}.${exc.to.slice(5, 7)}`
                    : `Static · ${exc.from.slice(8)}.${exc.from.slice(5, 7)}–${exc.to.slice(8)}.${exc.to.slice(5, 7)}`
                  : isNonTrading?.(value)
                    ? 'Неторговый день'
                    : undefined
              }
            >
              {Number(value.slice(8))}
            </button>
          );
        }}
      />

      <div className={styles.footer}>
        <span className={styles.selection}>
          {start ? `${start.slice(8)}.${start.slice(5, 7)}` : '—'}
          {' – '}
          {end ? `${end.slice(8)}.${end.slice(5, 7)}` : start ? `${start.slice(8)}.${start.slice(5, 7)}` : '—'}
          {hint ? <span className={styles.hint}> ({hint})</span> : null}
        </span>
        <button type="button" className={styles.go} onClick={go} disabled={!start}>
          Перейти
        </button>
      </div>
    </div>
  );
}
