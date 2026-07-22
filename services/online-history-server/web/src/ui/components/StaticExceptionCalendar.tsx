import { Tip } from '@scinverse/notification-center';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { datesOverlap } from '../../core/scheduleLayerDict';
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
  onGo: (from: string, to: string, opts: { create: boolean }) => void;
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

/** Календарные (static) на доске Eye+Календарь — тот же оттенок, чуть светлее полосок confirm. */
const STATIC_PREVIEW_YELLOWS = [
  'hsl(27.1deg 16.16% 68%)',
  'hsl(27deg 16% 62%)',
  'hsl(27deg 16% 74%)',
  'hsl(27deg 14% 56%)',
] as const;

export function layerTone(layerIndex: number): string {
  return LAYER_BLUES[((layerIndex % LAYER_BLUES.length) + LAYER_BLUES.length) % LAYER_BLUES.length];
}

/** Static на preview-доске (View+Календарь). */
export function staticPreviewTone(layerIndex: number): string {
  return STATIC_PREVIEW_YELLOWS[
    ((layerIndex % STATIC_PREVIEW_YELLOWS.length) + STATIC_PREVIEW_YELLOWS.length) %
      STATIC_PREVIEW_YELLOWS.length
  ];
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
 * Визуальные «доски»: уровень слоя = max(уровень пересечённых ниже) + 1.
 * Чистый визуал — не индекс в массиве; доска плоская на весь свой диапазон.
 */
function assignBoardLevels(exceptions: readonly StaticExcRange[]): number[] {
  const levels: number[] = [];
  for (let i = 0; i < exceptions.length; i++) {
    const e = exceptions[i];
    let maxUnder = -1;
    for (let j = 0; j < i; j++) {
      if (datesOverlap(e.from, e.to, exceptions[j].from, exceptions[j].to)) {
        maxUnder = Math.max(maxUnder, levels[j]);
      }
    }
    levels[i] = maxUnder + 1;
  }
  return levels;
}

/** Слоты гамбургера на день: 0..maxLevel, с пропусками где доска не лежит. */
function boardRibbonsForDay(
  iso: string,
  exceptions: readonly StaticExcRange[],
  boardLevels: readonly number[],
): { index: number; level: number; exc: StaticExcRange | null }[] {
  const covering: { index: number; level: number; exc: StaticExcRange }[] = [];
  exceptions.forEach((e, index) => {
    if (iso >= e.from && iso <= e.to) {
      covering.push({ index, level: boardLevels[index] ?? 0, exc: e });
    }
  });
  if (covering.length === 0) return [];

  const maxLevel = Math.max(...covering.map((c) => c.level));
  const byLevel = new Map(covering.map((c) => [c.level, c]));
  const slots: { index: number; level: number; exc: StaticExcRange | null }[] = [];
  for (let level = 0; level <= maxLevel; level++) {
    const hit = byLevel.get(level);
    slots.push(
      hit
        ? { index: hit.index, level, exc: hit.exc }
        : { index: -1, level, exc: null },
    );
  }
  return slots;
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

  const boardLevels = useMemo(() => assignBoardLevels(exceptions), [exceptions]);

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

  const selTo = end ?? start;
  const selectedLayerIndex =
    start != null && selTo != null
      ? exceptions.findIndex((e) => e.from === start && e.to === selTo)
      : -1;
  /** Клик по существующему слою → Перейти; новый диапазон → Создать. */
  const isExistingSelect = selectedLayerIndex >= 0 && !paintingNew;

  const go = () => {
    if (!start) return;
    setPaintingNew(false);
    onGo(start, end ?? start, { create: !isExistingSelect });
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
        <Tip content="Сбросить все static-исключения">
          <button type="button" className={styles.link} onClick={reset} tabIndex={-1}>
            Сбросить
          </button>
        </Tip>
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
          const stack = stackOnDay(value, exceptions);
          const aligned = boardRibbonsForDay(value, exceptions, boardLevels);
          const selected = inSel(value);
          const edge = isEdge(value);
          const topCovering = [...aligned].reverse().find((s) => s.exc != null);
          const topOff = topCovering?.exc?.mode === 'off';
          /** Черновик: доска на max(пересечённых) + 1. */
          const showDraftRibbon = selected && selectedLayerIndex < 0 && start != null;
          const draftLevel = showDraftRibbon
            ? (() => {
                const lo = start!;
                const hi = end ?? start!;
                let maxUnder = -1;
                exceptions.forEach((e, i) => {
                  if (datesOverlap(lo, hi, e.from, e.to)) {
                    maxUnder = Math.max(maxUnder, boardLevels[i] ?? 0);
                  }
                });
                return maxUnder + 1;
              })()
            : 0;
          const draftTone = layerTone(exceptions.length);
          const maxAligned = aligned.length > 0 ? aligned[aligned.length - 1].level : -1;
          const draftSlots: { kind: 'gap' | 'draft' }[] = [];
          if (showDraftRibbon) {
            for (let lv = maxAligned + 1; lv < draftLevel; lv++) draftSlots.push({ kind: 'gap' });
            draftSlots.push({ kind: 'draft' });
          }
          const hasRibbons = aligned.length > 0 || showDraftRibbon;

          const titleParts =
            stack.length > 0
              ? stack.map((s, i) => {
                  const isTop = i === stack.length - 1;
                  // ▲ только у активного: при черновике — ни у кого из стека; иначе у верхнего.
                  const mark = !showDraftRibbon && isTop ? '▲' : '·';
                  const level = (boardLevels[s.index] ?? 0) + 1;
                  return `${mark} L${level} ${fmtRange(s.exc.from, s.exc.to)}`;
                })
              : [];
          if (showDraftRibbon && start) {
            titleParts.push(`▲ Новый слой L${draftLevel + 1} ${fmtRange(start, end ?? start)}`);
          }

          return (
            <Tip key={value} content={titleParts.length > 0 ? titleParts.join('\n') : undefined} block>
              <button
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
              >
                <span className={styles.dayNum}>{Number(value.slice(8))}</span>
                {hasRibbons && (
                  <span className={styles.ribbons} aria-hidden="true">
                    {aligned.map((s) =>
                      s.exc ? (
                        <span
                          key={`${s.index}-${s.level}`}
                          className={[styles.ribbon, s.exc.mode === 'off' ? styles.ribbonOff : '']
                            .filter(Boolean)
                            .join(' ')}
                          style={s.exc.mode === 'off' ? undefined : { background: layerTone(s.index) }}
                        />
                      ) : (
                        <span key={`gap-${s.level}`} className={[styles.ribbon, styles.ribbonGap].join(' ')} />
                      ),
                    )}
                    {draftSlots.map((s, i) =>
                      s.kind === 'draft' ? (
                        <span key="draft" className={styles.ribbon} style={{ background: draftTone }} />
                      ) : (
                        <span key={`draft-gap-${i}`} className={[styles.ribbon, styles.ribbonGap].join(' ')} />
                      ),
                    )}
                  </span>
                )}
              </button>
            </Tip>
          );
        }}
      />

      <p className={styles.legend}>
        Полоски = слои · клик — верхний · макс. {maxSpanDays} дн.
      </p>

      <div className={styles.footer}>
        <span className={styles.selection}>
          {start ? `${start.slice(8)}.${start.slice(5, 7)}` : '—'}
          {' – '}
          {end ? `${end.slice(8)}.${end.slice(5, 7)}` : start ? '…' : '—'}
          {hint ? <span className={styles.hint}> ({hint})</span> : null}
        </span>
        <button type="button" className={styles.go} onClick={go} disabled={!start}>
          {isExistingSelect ? 'Редактировать' : 'Создать'}
        </button>
      </div>
    </div>
  );
}
