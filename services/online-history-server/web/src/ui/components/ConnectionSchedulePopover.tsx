import { useEffect, useState } from 'react';
import type { ConnectionScheduleDto, PutConnectionScheduleRequest } from '../../core/types';
import { OhsApi } from '../../core/api';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { CalendarIcon, EyeIcon, PencilIcon } from './icons';
import {
  DAY_MIN,
  ScheduleWindowRibbon,
  axisMinsToWindow,
  templateToAxisMins,
  windowToAxisMins,
} from './ScheduleWindowRibbon';
import styles from './ConnectionSchedulePopover.module.css';

interface Props {
  connectionId: number;
  current: ConnectionScheduleDto | undefined;
  open: boolean;
  onClose: () => void;
  onPublish: (body: PutConnectionScheduleRequest) => void;
}

/** Дни недели: Пн..Вс, значение — dow (0=вс..6=сб), как в SessionFilter. */
const WEEKDAYS: { dow: number; label: string }[] = [
  { dow: 1, label: 'Пн' },
  { dow: 2, label: 'Вт' },
  { dow: 3, label: 'Ср' },
  { dow: 4, label: 'Чт' },
  { dow: 5, label: 'Пт' },
  { dow: 6, label: 'Сб' },
  { dow: 0, label: 'Вс' },
];

const DAY_PRESETS: { id: string; label: string; days: number[] }[] = [
  { id: 'all', label: 'Все', days: [0, 1, 2, 3, 4, 5, 6] },
  { id: 'week', label: 'Будни', days: [1, 2, 3, 4, 5] },
  { id: 'weekend', label: 'Сб, Вс', days: [6, 0] },
];

type TemplateId = 'futures' | 'stock' | 'currency';

/** Шаблон = движок (для connection_schedule) + ключ рынка (для курируемой market_schedule). */
const TEMPLATES: { id: TemplateId; label: string; engine: string; market: string }[] = [
  { id: 'futures', label: 'MOEX срочный', engine: 'futures', market: 'derivatives' },
  { id: 'stock', label: 'MOEX фондовый', engine: 'stock', market: 'stock' },
  { id: 'currency', label: 'MOEX валютный', engine: 'currency', market: 'currency' },
];

/** Окно шаблона из market_schedule: будни (базовое для окна) + справочно выходные (ДСВД). */
interface TemplateWindow {
  openH: number;
  openM: number;
  closeH: number;
  closeM: number;
  weOpen: string | null;
  weClose: string | null;
}

type PresetMap = Record<TemplateId, TemplateWindow | null>;

const EMPTY_PRESETS: PresetMap = { futures: null, stock: null, currency: null };

const SHIFTS = [0, 1, 2, 3, 4] as const;

function sameDays(a: ReadonlySet<number>, days: number[]): boolean {
  return a.size === days.length && days.every((d) => a.has(d));
}

function allWeekdays(): Set<number> {
  return new Set([0, 1, 2, 3, 4, 5, 6]);
}

/** "HH:mm:ss" → {h, m}. */
function hmParts(hms: string): { h: number; m: number } {
  const [h, m] = hms.split(':');
  return { h: Number(h), m: Number(m) };
}

function isShiftValid(w: TemplateWindow | null, pad: number): boolean {
  return w != null && templateToAxisMins(w.openH, w.openM, w.closeH, w.closeM, pad) != null;
}

/** Popover расписания Connection: лента 48h + дни + шаблоны + история. */
export function ConnectionSchedulePopover({ connectionId, current, open, onClose, onPublish }: Props) {
  const store = useOhsStore();
  const highlightDays = useBehavior(store.highlightDays$);

  const [startMin, setStartMin] = useState(6 * 60);
  const [endMin, setEndMin] = useState(DAY_MIN + 60);
  const [engine, setEngine] = useState('futures');
  const [shiftHours, setShiftHours] = useState<number | null>(1);
  const [activeTemplate, setActiveTemplate] = useState<TemplateId | null>('futures');
  const [weekdays, setWeekdays] = useState<Set<number>>(allWeekdays);
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<ConnectionScheduleDto[]>([]);
  /** Окна пресетов из курируемой market_schedule (по ключу рынка), а не хардкод. */
  const [presets, setPresets] = useState<PresetMap>(EMPTY_PRESETS);
  /** Есть текущее расписание → старт в просмотре; иначе сразу редактирование. */
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (current) {
      const axis = windowToAxisMins(current.windowStart.slice(0, 5), current.windowEnd.slice(0, 5));
      setStartMin(axis.startMin);
      setEndMin(axis.endMin);
      setEngine(current.engine);
      const match = TEMPLATES.find((t) => t.engine === current.engine);
      setActiveTemplate(match?.id ?? null);
      setEditing(false);
    } else {
      const axis = windowToAxisMins('06:00', '01:00');
      setStartMin(axis.startMin);
      setEndMin(axis.endMin);
      setActiveTemplate('futures');
      setEngine('futures');
      setEditing(true);
    }
    setWeekdays(allWeekdays());
    setShiftHours(1);
    setNote('');
    OhsApi.getConnectionScheduleHistory(connectionId).subscribe({
      next: setHistory,
      error: () => setHistory([]),
    });
    // Пресеты — из курируемой market_schedule (источник истины окна), не из хардкода.
    setPresets(EMPTY_PRESETS);
    TEMPLATES.forEach((tpl) => {
      OhsApi.getMarketSchedule(tpl.market).subscribe({
        next: (ms) => {
          const o = hmParts(ms.wdOpen);
          const c = hmParts(ms.wdClose);
          setPresets((prev) => ({
            ...prev,
            [tpl.id]: {
              openH: o.h,
              openM: o.m,
              closeH: c.h,
              closeM: c.m,
              weOpen: ms.weOpen,
              weClose: ms.weClose,
            },
          }));
        },
        error: () => setPresets((prev) => ({ ...prev, [tpl.id]: null })),
      });
    });
  }, [open, connectionId, current]);

  if (!open) {
    return null;
  }

  const readOnly = !editing;
  const { start, end } = axisMinsToWindow(startMin, endMin);
  const activeTpl = TEMPLATES.find((t) => t.id === activeTemplate) ?? null;
  const activeWin = activeTemplate ? presets[activeTemplate] : null;
  const baseAxis = activeWin
    ? templateToAxisMins(activeWin.openH, activeWin.openM, activeWin.closeH, activeWin.closeM, 0)
    : null;

  const applyTemplate = (tpl: (typeof TEMPLATES)[number], pad: number | null) => {
    const w = presets[tpl.id];
    if (!w) {
      return;
    }
    const base = templateToAxisMins(w.openH, w.openM, w.closeH, w.closeM, 0);
    if (!base) {
      return;
    }

    // Без Shift: подсветить base; внутрь base зашедший край — к границе base, «шире» не трогаем.
    if (pad == null) {
      setEngine(tpl.engine);
      setActiveTemplate(tpl.id);
      setShiftHours(null);
      let s = startMin;
      let e = endMin;
      if (s > base.startMin && s < base.endMin) {
        s = base.startMin;
      }
      if (e > base.startMin && e < base.endMin) {
        e = base.endMin;
      }
      if (e <= s) {
        s = base.startMin;
        e = base.endMin;
      }
      setStartMin(s);
      setEndMin(e);
      return;
    }

    const axis = templateToAxisMins(w.openH, w.openM, w.closeH, w.closeM, pad);
    if (!axis) {
      return;
    }
    setEngine(tpl.engine);
    setActiveTemplate(tpl.id);
    setShiftHours(pad);
    setStartMin(axis.startMin);
    setEndMin(axis.endMin);
  };

  const selectShift = (pad: number) => {
    if (!activeTpl || !isShiftValid(activeWin, pad)) {
      return;
    }
    applyTemplate(activeTpl, pad);
  };

  /** Маркеры/drag: сначала сбрасываем shift; base — только если край зашёл внутрь base. */
  const onWindowChange = (s: number, e: number) => {
    setStartMin(s);
    setEndMin(e);
    setShiftHours(null);
    if (!activeTpl || !baseAxis) {
      return;
    }
    // Маркер «внутри» base: start правее open или end левее close.
    if (s > baseAxis.startMin || e < baseAxis.endMin) {
      setActiveTemplate(null);
    }
  };

  const toggleDay = (dow: number) => {
    if (readOnly) {
      return;
    }
    setWeekdays((prev) => {
      const next = new Set(prev);
      if (next.has(dow)) {
        if (next.size > 1) {
          next.delete(dow);
        }
      } else {
        next.add(dow);
      }
      return next;
    });
  };

  const approve = () => {
    if (readOnly) {
      return;
    }
    if (!window.confirm('Опубликовать новую версию расписания соединения?')) {
      return;
    }
    const dayLabels = WEEKDAYS.filter((w) => weekdays.has(w.dow))
      .map((w) => w.label)
      .join(',');
    const daysNote = weekdays.size === 7 ? null : `дни: ${dayLabels}`;
    const combinedNote = [note.trim() || null, daysNote].filter(Boolean).join(' · ') || null;
    onPublish({
      mode: current?.mode ?? 'manual',
      windowStart: `${start}:00`,
      windowEnd: `${end}:00`,
      engine,
      tz: 'Europe/Moscow',
      changeSource: 'ui',
      changeNote: combinedNote,
    });
    onClose();
  };

  return (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Расписание соединения"
      >
        <header className={styles.head}>
          <strong>Расписание соединения</strong>
          <div className={styles.headActions}>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => {
                setEditing((v) => {
                  const next = !v;
                  // Выход из редактирования → снова показываем утверждённое окно.
                  if (!next && current) {
                    const axis = windowToAxisMins(
                      current.windowStart.slice(0, 5),
                      current.windowEnd.slice(0, 5),
                    );
                    setStartMin(axis.startMin);
                    setEndMin(axis.endMin);
                    setEngine(current.engine);
                    const match = TEMPLATES.find((t) => t.engine === current.engine);
                    setActiveTemplate(match?.id ?? null);
                    setWeekdays(allWeekdays());
                    setShiftHours(1);
                    setNote('');
                  }
                  return next;
                });
              }}
              title={editing ? 'Режим редактирования' : 'Режим просмотра'}
              aria-label={editing ? 'Переключить в просмотр' : 'Переключить в редактирование'}
              aria-pressed={editing}
            >
              {editing ? <PencilIcon className={styles.headIcon} /> : <EyeIcon className={styles.headIcon} />}
            </button>
            <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Закрыть">
              <span className={styles.closeGlyph} aria-hidden="true">
                ×
              </span>
            </button>
          </div>
        </header>

        <ScheduleWindowRibbon
          startMin={startMin}
          endMin={endMin}
          highlightDays={highlightDays}
          readOnly={readOnly}
          baseStartMin={baseAxis?.startMin ?? null}
          baseEndMin={baseAxis?.endMin ?? null}
          onChange={onWindowChange}
        />

        <div className={[styles.section, readOnly ? styles.sectionLocked : ''].filter(Boolean).join(' ')}>
          <span className={styles.sectionTitle}>Дни</span>
          <div className={styles.chips}>
            {DAY_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={[styles.chip, sameDays(weekdays, p.days) ? styles.chipOn : '']
                  .filter(Boolean)
                  .join(' ')}
                disabled={readOnly}
                onClick={() => setWeekdays(new Set(p.days))}
              >
                {p.label}
              </button>
            ))}
            <span className={styles.divider} />
            <button type="button" className={styles.chip} disabled title="Торговый календарь MOEX — позже">
              <CalendarIcon className={styles.chipIcon} />
              MOEX
            </button>
            <button type="button" className={styles.chip} disabled title="Торговый календарь CME — позже">
              <CalendarIcon className={styles.chipIcon} />
              CME
            </button>
          </div>
          <div className={styles.days}>
            {WEEKDAYS.map((w) => (
              <button
                key={w.dow}
                type="button"
                className={[styles.day, weekdays.has(w.dow) ? styles.dayOn : ''].filter(Boolean).join(' ')}
                disabled={readOnly}
                onClick={() => toggleDay(w.dow)}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        <div className={[styles.section, readOnly ? styles.sectionLocked : ''].filter(Boolean).join(' ')}>
          <span className={styles.sectionTitle}>Шаблоны</span>
          <div className={styles.chips}>
            {TEMPLATES.map((tpl) => {
              const w = presets[tpl.id];
              const loaded = w != null;
              // Без shift — base всегда можно выбрать (маркеры не двигаем).
              const canApply = loaded && (shiftHours == null || isShiftValid(w, shiftHours));
              return (
                <button
                  key={tpl.id}
                  type="button"
                  className={[styles.chip, activeTemplate === tpl.id ? styles.chipOn : '']
                    .filter(Boolean)
                    .join(' ')}
                  disabled={readOnly || !canApply}
                  onClick={() => applyTemplate(tpl, shiftHours)}
                  title={
                    !loaded
                      ? 'Расписание рынка недоступно (market_schedule)'
                      : canApply
                        ? shiftHours == null
                          ? 'Base: край внутри — к границе base; шире — без изменений (Shift 0 — полное выравнивание)'
                          : undefined
                        : `Shift ${shiftHours}: окно base±shift длиннее 24ч или за hard frame`
                  }
                >
                  {tpl.label}
                </button>
              );
            })}
            <span className={styles.divider} />
            {SHIFTS.map((n) => {
              const valid = isShiftValid(activeWin, n);
              return (
                <button
                  key={n}
                  type="button"
                  className={[styles.chip, shiftHours === n ? styles.chipOn : ''].filter(Boolean).join(' ')}
                  disabled={readOnly || !valid}
                  onClick={() => selectShift(n)}
                  title={
                    valid
                      ? `Сдвиг окна ±${n} ч к границам шаблона`
                      : `Shift ${n}: окно base±shift длиннее 24ч или за hard frame`
                  }
                >
                  {n === 0 ? 'Shift 0' : String(n)}
                </button>
              );
            })}
          </div>
          {activeWin && (
            <span className={styles.meta}>
              Из market_schedule · будни{' '}
              {String(activeWin.openH).padStart(2, '0')}:{String(activeWin.openM).padStart(2, '0')}–
              {String(activeWin.closeH).padStart(2, '0')}:{String(activeWin.closeM).padStart(2, '0')}
              {activeWin.weOpen && activeWin.weClose
                ? ` · выходные ${activeWin.weOpen.slice(0, 5)}–${activeWin.weClose.slice(0, 5)}`
                : ' · выходные: нет торгов'}
            </span>
          )}
        </div>

        <label className={styles.note}>
          Комментарий
          <input
            type="text"
            value={note}
            placeholder="например: брокер рвёт до 07:00"
            disabled={readOnly}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <button
          type="button"
          className={styles.approve}
          onClick={approve}
          disabled={readOnly}
          title={readOnly ? 'Переключитесь в режим редактирования' : undefined}
        >
          Утвердить
        </button>

        {history.length > 0 && (
          <section className={styles.history}>
            <h4>История</h4>
            <ul>
              {history.map((h) => (
                <li key={h.scheduleId}>
                  <span>
                    {h.windowStart.slice(0, 5)}–{h.windowEnd.slice(0, 5)} · {h.engine}
                  </span>
                  <span className={styles.meta}>
                    {new Date(h.effectiveFrom).toLocaleString('ru-RU')} · {h.changeSource}
                    {h.changeNote ? ` · ${h.changeNote}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
