import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { MONTHS_RU, MonthGrid } from './MonthGrid';
import styles from './StaticExceptionCalendar.module.css';

export interface StaticExcRange {
  from: string;
  to: string;
  mode: 'window' | 'off';
}

interface Props {
  /** Static-исключения снизу вверх (last = верхний слой). */
  exceptions: readonly StaticExcRange[];
  maxSpanDays?: number;
  isNonTrading?: (iso: string) => boolean;
  onViewChange?: (year: number, month: number) => void;
  onGo: (from: string, to: string) => void;
  onClearAll: () => void;
  /** Esc без выделения — закрыть календарь (как click-outside). */
  onDismiss?: () => void;
}

/** Синие тона ленты: один hue, сильно разная насыщенность/светлота. */
const LAYER_BLUES = [
  'hsl(204 88% 58%)',
  'hsl(204 95% 72%)',
  'hsl(204 90% 38%)',
  'hsl(204 42% 55%)',
  'hsl(204 98% 78%)',
  'hsl(204 82% 30%)',
  'hsl(204 28% 60%)',
] as const;

export function layerTone(layerIndex: number): string {
  return LAYER_BLUES[((layerIndex % LAYER_BLUES.length) + LAYER_BLUES.length) % LAYER_BLUES.length];
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

function fmtRange(from: string, to: string): string {
  const a = `${from.slice(8)}.${from.slice(5, 7)}`;
  const b = `${to.slice(8)}.${to.slice(5, 7)}`;
  return from === to ? a : `${a}–${b}`;
}

function stackOnDay(
  iso: string,
  exceptions: readonly StaticExcRange[],
): { exc: StaticExcRange; index: number }[] {
  const out: { exc: StaticExcRange; index: number }[] = [];
  exceptions.forEach((e, index) => {
    if (iso >= e.from && iso <= e.to) out.push({ exc: e, index });
  });
  return out;
}

/**
 * Календарь static-исключений.
 * Ленты слоёв — цветные полоски в ячейке (всегда видны, и с выбором, и без).
 * Клик — верхний слой; Ctrl — новый; Esc / клик мимо дат — снять выделение.
 */
export function StaticExceptionCalendar({
  exceptions,
  maxSpanDays = 14,
  isNonTrading,
  onViewChange,
  onGo,
  onClearAll,
  onDismiss,
}: Props) {
  const today = new Date();
  const [view, setView] = useState({ year: today.getFullYear(), month: today.getMonth() });
  /** При открытии — ничего не выделено. */
  const [start, setStart] = useState<string | undefined>(undefined);
  const [end, setEnd] = useState<string | undefined>(undefined);
  const [paintingNew, setPaintingNew] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(start);
  startRef.current = start;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    onViewChange?.(view.year, view.month);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onViewChange
  }, [view.year, view.month]);

  const clearSelection = () => {
    setStart(undefined);
    setEnd(undefined);
    setPaintingNew(false);
    setHint(null);
    // Как click-outside: снять :focus-visible с ячейки, иначе остаётся синий outline.
    const ae = document.activeElement;
    if (ae instanceof HTMLElement && rootRef.current?.contains(ae)) ae.blur();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      // Есть выделение — сброс дат; иначе закрыть поповер (как click-outside).
      if (startRef.current != null) clearSelection();
      else onDismissRef.current?.();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const stackByDay = useMemo(() => {
    const map = new Map<string, { exc: StaticExcRange; index: number }[]>();
    exceptions.forEach((e, index) => {
      let cur = e.from;
      let guard = 0;
      while (cur <= e.to && guard < 400) {
        const prev = map.get(cur) ?? [];
        map.set(cur, [...prev, { exc: e, index }]);
        cur = addDaysIso(cur, 1);
        guard += 1;
      }
    });
    return map;
  }, [exceptions]);

  const pick = (value: string, withCtrl: boolean) => {
    setHint(null);
    const stack = stackOnDay(value, exceptions);
    const top = stack.length > 0 ? stack[stack.length - 1] : undefined;
    const midDraft = start != null && end == null;

    if (withCtrl) setPaintingNew(true);

    if (!withCtrl && !paintingNew && !midDraft && top) {
      setStart(top.exc.from);
      setEnd(top.exc.to);
      setPaintingNew(false);
      return;
    }

    if (!start || (start && end != null && !midDraft)) {
      setStart(value);
      setEnd(undefined);
      setPaintingNew(true);
      return;
    }

    let lo = value < start ? value : start;
    let hi = value < start ? start : value;
    if (spanDays(lo, hi) > maxSpanDays) {
      hi = addDaysIso(lo, maxSpanDays - 1);
      setHint(`макс. ${maxSpanDays} дн.`);
    } else {
      setHint(null);
    }
    setStart(lo);
    setEnd(hi);
    setPaintingNew(false);
  };

  const shiftMonth = (delta: number) => {
    const base = new Date(view.year, view.month + delta, 1);
    setView({ year: base.getFullYear(), month: base.getMonth() });
  };

  const goToday = () => setView({ year: today.getFullYear(), month: today.getMonth() });

  const reset = () => {
    clearSelection();
    onClearAll();
  };

  const go = () => {
    if (!start) return;
    setPaintingNew(false);
    onGo(start, end ?? start);
  };

  const inSel = (value: string) => {
    if (start == null) return false;
    if (end == null) return value === start;
    return value >= start && value <= end;
  };

  const isEdge = (value: string) => {
    if (start == null) return false;
    if (end == null) return value === start;
    return value === start || value === end;
  };

  const selTo = end ?? start;
  const selectedLayerIndex =
    start != null && selTo != null
      ? exceptions.findIndex((e) => e.from === start && e.to === selTo)
      : -1;

  const onRootPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest(`.${styles.cell}`)) return;
    if (t.closest(`.${styles.go}`)) return;
    if (t.closest(`.${styles.link}`)) return;
    if (t.closest(`.${styles.navBtn}`)) return;
    clearSelection();
  };

  return (
    <div ref={rootRef} className={styles.root} onPointerDown={onRootPointerDown}>
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
          const stack = stackByDay.get(value) ?? [];
          const selected = inSel(value);
          const edge = isEdge(value);
          const top = stack.length > 0 ? stack[stack.length - 1] : undefined;
          const topOff = top?.exc.mode === 'off';
          /** Черновик нового слоя — полоска сразу сверху, пока нет в exceptions. */
          const showDraftRibbon = selected && selectedLayerIndex < 0 && start != null;
          const hasRibbons = stack.length > 0 || showDraftRibbon;
          const draftTone = layerTone(exceptions.length);

          const titleParts =
            stack.length > 0
              ? stack.map((s, i) => {
                  const mark = i === stack.length - 1 ? '▲' : '·';
                  const mode = s.exc.mode === 'off' ? 'выкл' : 'окно';
                  return `${mark} L${s.index + 1} ${fmtRange(s.exc.from, s.exc.to)} (${mode})`;
                })
              : isNonTrading?.(value)
                ? ['Неторговый день']
                : [];
          if (showDraftRibbon) titleParts.push('▲ новый слой (черновик)');
          if (stack.length > 0) titleParts.push('Ctrl+клик — новый слой');

          return (
            <button
              key={value}
              type="button"
              className={[
                styles.cell,
                hasRibbons ? styles.cellHasLayers : '',
                selected ? styles.cellSelected : '',
                edge ? styles.cellEdge : '',
                paintingNew && start === value && end == null ? styles.cellPainting : '',
                topOff ? styles.cellTopOff : '',
                isNonTrading?.(value) ? styles.cellNonTrading : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={(e) => pick(value, e.ctrlKey || e.metaKey)}
              title={titleParts.length > 0 ? titleParts.join('\n') : undefined}
            >
              <span className={styles.dayNum}>{Number(value.slice(8))}</span>
              {hasRibbons && (
                <span className={styles.ribbons} aria-hidden="true">
                  {stack.map((s) => (
                    <span
                      key={`${s.index}-${s.exc.from}`}
                      className={[styles.ribbon, s.exc.mode === 'off' ? styles.ribbonOff : '']
                        .filter(Boolean)
                        .join(' ')}
                      style={s.exc.mode === 'off' ? undefined : { background: layerTone(s.index) }}
                    />
                  ))}
                  {showDraftRibbon && (
                    <span className={styles.ribbon} style={{ background: draftTone }} />
                  )}
                </span>
              )}
            </button>
          );
        }}
      />

      <p className={styles.legend}>
        Полоски = слои · клик — верхний · <kbd>Ctrl</kbd>+клик — новый · макс. {maxSpanDays} дн.
      </p>

      <div className={styles.footer}>
        <span className={styles.selection}>
          {start ? `${start.slice(8)}.${start.slice(5, 7)}` : '—'}
          {' – '}
          {end ? `${end.slice(8)}.${end.slice(5, 7)}` : start ? '…' : '—'}
          {hint ? <span className={styles.hint}> ({hint})</span> : null}
        </span>
        <button type="button" className={styles.go} onClick={go} disabled={!start}>
          Перейти
        </button>
      </div>
    </div>
  );
}
