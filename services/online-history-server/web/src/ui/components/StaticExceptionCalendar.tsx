import { useEffect, useMemo, useState, type CSSProperties } from 'react';
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
  /** Текущий активный скоуп (подсветка выбора). */
  activeFrom?: string;
  activeTo?: string;
  maxSpanDays?: number;
  /** Неторговые дни биржи (красный текст). */
  isNonTrading?: (iso: string) => boolean;
  onViewChange?: (year: number, month: number) => void;
  /** Перейти к выбранной дате/диапазону (новый или существующий → promote). */
  onGo: (from: string, to: string) => void;
  /** Сбросить все static-исключения. */
  onClearAll: () => void;
}

/** Базовый синий + сдвиг по номеру слоя (уникальный тон нахлёста). */
const TONE_STEP = 14;

export function layerTone(layerIndex: number): string {
  const hue = 205 + (layerIndex % 7) * TONE_STEP;
  const sat = 62 + (layerIndex % 3) * 6;
  const light = 46 + (layerIndex % 4) * 5;
  return `hsl(${hue} ${sat}% ${light}%)`;
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

function stackOnDay(iso: string, exceptions: readonly StaticExcRange[]): { exc: StaticExcRange; index: number }[] {
  const out: { exc: StaticExcRange; index: number }[] = [];
  exceptions.forEach((e, index) => {
    if (iso >= e.from && iso <= e.to) out.push({ exc: e, index });
  });
  return out;
}

/**
 * Календарь static-исключений: многослойный стек с пересечениями.
 * Клик — верхний слой; Ctrl/Cmd+клик — новый слой (в т.ч. внутри диапазона), второй клик без Ctrl завершает.
 * Цвет ячейки = тон верхнего слоя (layerIndex × tone).
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
  /** После Ctrl+клика — режим нового слоя, пока не завершим диапазон / не выберем существующий. */
  const [paintingNew, setPaintingNew] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    onViewChange?.(view.year, view.month);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onViewChange
  }, [view.year, view.month]);

  useEffect(() => {
    setStart(activeFrom);
    setEnd(activeTo ?? activeFrom);
    setPaintingNew(false);
  }, [activeFrom, activeTo]);

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

    if (withCtrl) {
      setPaintingNew(true);
    }

    // Обычный клик по слою → выбрать верхний (не в режиме «рисуем новый»).
    if (!withCtrl && !paintingNew && !midDraft && top) {
      setStart(top.exc.from);
      setEnd(top.exc.to);
      setPaintingNew(false);
      return;
    }

    // Новый слой: Ctrl или продолжение paintingNew / midDraft.
    if (!start || (start && end != null && !midDraft)) {
      // Старт нового диапазона (в т.ч. внутри чужого слоя).
      setStart(value);
      setEnd(undefined);
      setPaintingNew(true);
      setHint('новый слой — кликните конец диапазона');
      return;
    }

    // Вторая точка диапазона (Ctrl не обязателен).
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
    setStart(undefined);
    setEnd(undefined);
    setPaintingNew(false);
    setHint(null);
    onClearAll();
  };

  const go = () => {
    if (!start) return;
    setPaintingNew(false);
    onGo(start, end ?? start);
  };

  const inDraft = (value: string) => {
    if (start == null) return false;
    if (end == null) return value === start;
    return value >= start && value <= end;
  };

  const isEdge = (value: string) => {
    if (start == null) return false;
    if (end == null) return value === start;
    return value === start || value === end;
  };

  const draftIsOff =
    start != null &&
    exceptions.some((e) => e.from === start && e.to === (end ?? start) && e.mode === 'off');

  /** Тон для текущего draft (следующий слой после существующих). */
  const draftTone = layerTone(exceptions.length);

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
          const stack = stackByDay.get(value) ?? [];
          const top = stack.length > 0 ? stack[stack.length - 1] : undefined;
          const inSel = inDraft(value);
          const edge = isEdge(value);
          const selTo = end ?? start;
          const selectedMatchesTop =
            start != null &&
            selTo != null &&
            top != null &&
            top.exc.from === start &&
            top.exc.to === selTo;
          /** Выбор существующего слоя, который здесь не верхний — не затираем верх. */
          const selectedBelow =
            inSel &&
            !paintingNew &&
            end != null &&
            start != null &&
            top != null &&
            !(top.exc.from === start && top.exc.to === selTo);

          // Всегда красим верхним слоем стека; draft-заливка только если рисуем новый или выбран верхний.
          const showTopFill = stack.length > 0 && !(inSel && (paintingNew || selectedMatchesTop) && !selectedBelow);
          const showDraftFill = inSel && !selectedBelow && (paintingNew || selectedMatchesTop || stack.length === 0);
          const showBelowOutline = selectedBelow;

          const topOff = top?.exc.mode === 'off';
          const anyOff = stack.some((s) => s.exc.mode === 'off');
          const tone = top ? layerTone(top.index) : undefined;
          const depth = Math.min(stack.length, 4);
          const fillAlpha = 0.14 + Math.min(stack.length, 4) * 0.08;

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
          if (stack.length > 0) {
            titleParts.push('Ctrl+клик — новый слой внутри/поверх');
          }

          let style: CSSProperties | undefined;
          if (showTopFill && tone) {
            style = {
              background: `color-mix(in srgb, ${tone} ${Math.round(fillAlpha * 100)}%, transparent)`,
              boxShadow:
                topOff || anyOff
                  ? `inset 0 0 0 1.5px color-mix(in srgb, #e05555 80%, transparent), inset 0 0 0 3px color-mix(in srgb, ${tone} 20%, transparent)`
                  : `inset 0 0 0 1px color-mix(in srgb, ${tone} 45%, transparent)`,
            };
          }
          if (showBelowOutline && tone) {
            // Нижний выбранный слой: верхний fill остаётся, добавляем пунктир «выбран ниже».
            style = {
              ...(style ?? {}),
              outline: `1px dashed color-mix(in srgb, ${layerTone(
                exceptions.findIndex((e) => e.from === start && e.to === selTo),
              )} 70%, transparent)`,
              outlineOffset: '-2px',
            };
          }
          if (showDraftFill && !edge) {
            style = {
              background: `color-mix(in srgb, ${draftTone} 22%, transparent)`,
              ...(selectedMatchesTop && tone
                ? {
                    background: `color-mix(in srgb, ${tone} 28%, transparent)`,
                    boxShadow: `inset 0 0 0 1.5px ${tone}`,
                  }
                : {}),
            };
          }
          if (showDraftFill && edge) {
            style = {
              background: draftIsOff
                ? 'color-mix(in srgb, #e05555 85%, #000)'
                : selectedMatchesTop && tone
                  ? tone
                  : draftTone,
            };
          }
          // Края выбранного нижнего слоя — заметные, но fill дня с верхним слоем не трогаем.
          if (showBelowOutline && edge) {
            const belowTone = layerTone(exceptions.findIndex((e) => e.from === start && e.to === selTo));
            style = {
              ...(style ?? {}),
              boxShadow: `inset 0 0 0 2px ${belowTone}`,
              outline: `1px solid ${belowTone}`,
              outlineOffset: '-1px',
            };
          }

          return (
            <button
              key={value}
              type="button"
              className={[
                styles.cell,
                showTopFill ? styles.cellStack : '',
                showTopFill && depth >= 2 ? styles.cellStackDeep : '',
                showTopFill && (topOff || anyOff) ? styles.cellStackOff : '',
                showDraftFill && edge ? styles.cellEdge : '',
                showDraftFill && !edge ? styles.cellInRange : '',
                showDraftFill && draftIsOff ? styles.cellEdgeOff : '',
                showBelowOutline ? styles.cellSelectedBelow : '',
                paintingNew && midDraftAnchor(value, start, end) ? styles.cellPainting : '',
                isNonTrading?.(value) ? styles.cellNonTrading : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={style}
              onClick={(e) => pick(value, e.ctrlKey || e.metaKey)}
              title={titleParts.length > 0 ? titleParts.join('\n') : undefined}
            >
              {Number(value.slice(8))}
            </button>
          );
        }}
      />

      <p className={styles.legend}>
        Клик — верхний слой · <kbd>Ctrl</kbd>+клик — новый внутри · Перейти поднимает слой и снимает
        вложенные · макс. {maxSpanDays} дн.
        {paintingNew ? <span className={styles.paintingHint}> · рисуем новый слой</span> : null}
      </p>

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

function midDraftAnchor(value: string, start: string | undefined, end: string | undefined): boolean {
  return start != null && end == null && value === start;
}
