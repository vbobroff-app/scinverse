import { useEffect, useMemo, useState } from 'react';
import type {
  ConnectionScheduleRuleDto,
  ConnectionScheduleStateDto,
  PutConnectionScheduleRuleRequest,
} from '../../core/types';
import { OhsApi } from '../../core/api';
import { dowBit, hmsToMin } from '../../core/connectionSchedule';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { CalendarIcon, EyeIcon, PencilIcon } from './icons';
import {
  DAY_MIN,
  ScheduleWindowRibbon,
  templateToAxisMins,
} from './ScheduleWindowRibbon';
import { WeeklyScheduleOverview, type SchedulePreview } from './WeeklyScheduleOverview';
import styles from './ConnectionSchedulePopover.module.css';

interface Props {
  connectionId: number;
  state: ConnectionScheduleStateDto | undefined;
  open: boolean;
  onClose: () => void;
  onUpsertRule: (body: PutConnectionScheduleRuleRequest) => void;
  onCancelRule: (scheduleId: number) => void;
}

/** Дни недели: Пн..Вс, значение — js dow (0=вс..6=сб). */
const WEEKDAYS: { dow: number; label: string }[] = [
  { dow: 1, label: 'Пн' },
  { dow: 2, label: 'Вт' },
  { dow: 3, label: 'Ср' },
  { dow: 4, label: 'Чт' },
  { dow: 5, label: 'Пт' },
  { dow: 6, label: 'Сб' },
  { dow: 0, label: 'Вс' },
];

type ScopeMode = 'window' | 'off';

const WEEKDAY_DAYS = [1, 2, 3, 4, 5];
const WEEKEND_DAYS = [6, 0];

type TemplateId = 'futures' | 'stock' | 'currency';

const TEMPLATES: { id: TemplateId; label: string; engine: string; market: string }[] = [
  { id: 'futures', label: 'MOEX срочный', engine: 'futures', market: 'derivatives' },
  { id: 'stock', label: 'MOEX фондовый', engine: 'stock', market: 'stock' },
  { id: 'currency', label: 'MOEX валютный', engine: 'currency', market: 'currency' },
];

type DayType = 'weekday' | 'weekend';

interface DayWindow {
  openH: number;
  openM: number;
  closeH: number;
  closeM: number;
}

interface TemplateWindow {
  wd: DayWindow;
  we: DayWindow | null;
}

type PresetMap = Record<TemplateId, TemplateWindow | null>;

const EMPTY_PRESETS: PresetMap = { futures: null, stock: null, currency: null };

const SHIFTS = [0, 1, 2, 3, 4] as const;

/** Маска дней (Пн=1…Вс=64) из набора js-дней. */
function maskFromDays(days: ReadonlySet<number>): number {
  let mask = 0;
  for (const d of days) {
    mask |= dowBit(d);
  }
  return mask;
}

function sameDays(a: ReadonlySet<number>, days: number[]): boolean {
  return a.size === days.length && days.every((d) => a.has(d));
}

function dayTypeOf(days: ReadonlySet<number>): DayType {
  return days.size > 0 && [...days].every((d) => d === 0 || d === 6) ? 'weekend' : 'weekday';
}

function pickWindow(w: TemplateWindow | null, dt: DayType): DayWindow | null {
  if (!w) return null;
  return dt === 'weekend' ? w.we : w.wd;
}

function hmParts(hms: string): { h: number; m: number } {
  const [h, m] = hms.split(':');
  return { h: Number(h), m: Number(m) };
}

function fmtWindow(w: DayWindow): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(w.openH)}:${p(w.openM)}–${p(w.closeH)}:${p(w.closeM)}`;
}

function fmtMin(min: number): string {
  const norm = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(norm / 60)).padStart(2, '0')}:${String(norm % 60).padStart(2, '0')}`;
}

function isShiftValid(w: DayWindow | null, pad: number): boolean {
  return w != null && templateToAxisMins(w.openH, w.openM, w.closeH, w.closeM, pad) != null;
}

/** Ось (startMin/endMin) из правила окна (open + duration). */
function ruleToAxis(rule: ConnectionScheduleRuleDto): { startMin: number; endMin: number } | null {
  if (rule.mode !== 'window' || rule.open == null || rule.durationMin == null) return null;
  const startMin = hmsToMin(rule.open);
  return { startMin, endMin: startMin + rule.durationMin };
}

/**
 * Popover расписания Connection (phase 7j v2): выбор скоупа (основное / дни), режим window|off,
 * окно = open+duration на ленте 48h, read-only обзор недели с дорожками правил.
 */
export function ConnectionSchedulePopover({
  connectionId,
  state,
  open,
  onClose,
  onUpsertRule,
  onCancelRule,
}: Props) {
  const store = useOhsStore();
  const highlightDays = useBehavior(store.highlightDays$);

  const rules = useMemo(() => state?.rules ?? [], [state]);

  const [startMin, setStartMin] = useState(6 * 60);
  const [endMin, setEndMin] = useState(DAY_MIN + 60);
  const [engine, setEngine] = useState('futures');
  const [shiftHours, setShiftHours] = useState<number | null>(1);
  const [activeTemplate, setActiveTemplate] = useState<TemplateId | null>('futures');
  /** Скоуп-«основное» (main) vs дни (dow). */
  const [scopeMain, setScopeMain] = useState(true);
  const [weekdays, setWeekdays] = useState<Set<number>>(() => new Set(WEEKDAY_DAYS));
  const [mode, setMode] = useState<ScopeMode>('window');
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<ConnectionScheduleRuleDto[]>([]);
  const [presets, setPresets] = useState<PresetMap>(EMPTY_PRESETS);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Старт: если есть правила — просмотр, редактируем «основное»; иначе сразу редактирование.
    setScopeMain(true);
    setWeekdays(new Set(WEEKDAY_DAYS));
    setMode('window');
    setShiftHours(1);
    setNote('');
    setEditing(rules.length === 0);

    const main = rules.find((r) => r.scopeKind === 'main');
    const axis = main ? ruleToAxis(main) : null;
    if (axis) {
      setStartMin(axis.startMin);
      setEndMin(axis.endMin);
      setMode(main!.mode === 'off' ? 'off' : 'window');
    } else {
      setStartMin(6 * 60);
      setEndMin(DAY_MIN + 60);
    }
    setEngine(state?.settings.engine ?? 'futures');
    setActiveTemplate(TEMPLATES.find((t) => t.engine === (state?.settings.engine ?? 'futures'))?.id ?? 'futures');

    OhsApi.getConnectionScheduleHistory(connectionId).subscribe({
      next: setHistory,
      error: () => setHistory([]),
    });

    setPresets(EMPTY_PRESETS);
    TEMPLATES.forEach((tpl) => {
      OhsApi.getMarketSchedule(tpl.market).subscribe({
        next: (ms) => {
          const wo = hmParts(ms.wdOpen);
          const wc = hmParts(ms.wdClose);
          const weOpen = ms.weOpen ? hmParts(ms.weOpen) : null;
          const weClose = ms.weClose ? hmParts(ms.weClose) : null;
          const we =
            weOpen && weClose
              ? { openH: weOpen.h, openM: weOpen.m, closeH: weClose.h, closeM: weClose.m }
              : null;
          setPresets((prev) => ({
            ...prev,
            [tpl.id]: { wd: { openH: wo.h, openM: wo.m, closeH: wc.h, closeM: wc.m }, we },
          }));
        },
        error: () => setPresets((prev) => ({ ...prev, [tpl.id]: null })),
      });
    });
  }, [open, connectionId, rules, state]);

  if (!open) return null;

  const readOnly = !editing;
  const dowMask = maskFromDays(weekdays);
  const scopeKind = scopeMain ? 'main' : 'dow';
  const activeTpl = TEMPLATES.find((t) => t.id === activeTemplate) ?? null;
  const dayType = scopeMain ? 'weekday' : dayTypeOf(weekdays);
  const activeTplWin = activeTemplate ? presets[activeTemplate] : null;
  const activeWin = pickWindow(activeTplWin, dayType);
  const baseAxis = activeWin
    ? templateToAxisMins(activeWin.openH, activeWin.openM, activeWin.closeH, activeWin.closeM, 0)
    : null;

  /** Найти живое правило для выбранного скоупа (для загрузки в редактор). */
  const loadScopeRule = (main: boolean, days: ReadonlySet<number>) => {
    const rule = main
      ? rules.find((r) => r.scopeKind === 'main')
      : rules.find((r) => r.scopeKind === 'dow' && r.dowMask === maskFromDays(days));
    if (!rule) {
      setMode('window');
      return;
    }
    setMode(rule.mode === 'off' ? 'off' : 'window');
    const axis = ruleToAxis(rule);
    if (axis) {
      setStartMin(axis.startMin);
      setEndMin(axis.endMin);
    }
  };

  const chooseScope = (main: boolean, days: number[] | null) => {
    if (readOnly) return;
    setScopeMain(main);
    const next = days ? new Set(days) : weekdays;
    if (days) setWeekdays(next);
    loadScopeRule(main, next);
  };

  const toggleDay = (dow: number) => {
    if (readOnly) return;
    const next = new Set(weekdays);
    if (next.has(dow)) {
      if (next.size > 1) next.delete(dow);
    } else {
      next.add(dow);
    }
    chooseScope(false, [...next]);
  };

  const applyTemplate = (tpl: (typeof TEMPLATES)[number], pad: number | null, dt: DayType = dayType) => {
    const w = pickWindow(presets[tpl.id], dt);
    if (!w) return;
    const axis = templateToAxisMins(w.openH, w.openM, w.closeH, w.closeM, pad ?? 0);
    if (!axis) return;
    setEngine(tpl.engine);
    setActiveTemplate(tpl.id);
    setShiftHours(pad);
    setStartMin(axis.startMin);
    setEndMin(axis.endMin);
  };

  const selectShift = (pad: number) => {
    if (!activeTpl || !isShiftValid(activeWin, pad)) return;
    applyTemplate(activeTpl, pad);
  };

  const onWindowChange = (s: number, e: number) => {
    setStartMin(s);
    setEndMin(e);
    setShiftHours(null);
    if (!activeTpl || !baseAxis) return;
    if (s > baseAxis.startMin || e < baseAxis.endMin) setActiveTemplate(null);
  };

  const openHm = fmtMin(startMin);
  const durationMin = Math.min(Math.max(endMin - startMin, 1), 1439);

  const preview: SchedulePreview = {
    scopeKind,
    dowMask: scopeMain ? null : dowMask,
    mode,
    open: mode === 'window' ? `${openHm}:00` : null,
    durationMin: mode === 'window' ? durationMin : null,
  };

  const approve = () => {
    if (readOnly) return;
    if (!scopeMain && dowMask === 0) return;
    const scopeText = scopeMain ? 'основное' : WEEKDAYS.filter((w) => weekdays.has(w.dow)).map((w) => w.label).join(',');
    if (!window.confirm(`Утвердить правило «${scopeText}»?`)) return;
    const body: PutConnectionScheduleRuleRequest =
      mode === 'off'
        ? { scopeKind, dowMask: scopeMain ? null : dowMask, mode: 'off', changeSource: 'ui', changeNote: note.trim() || null }
        : {
            scopeKind,
            dowMask: scopeMain ? null : dowMask,
            mode: 'window',
            open: `${openHm}:00`,
            durationMin,
            changeSource: 'ui',
            changeNote: note.trim() || null,
          };
    onUpsertRule(body);
    onClose();
  };

  return (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div className={styles.panel} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Расписание соединения">
        <header className={styles.head}>
          <strong>Расписание соединения</strong>
          <div className={styles.headActions}>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => setEditing((v) => !v)}
              title={editing ? 'Режим редактирования' : 'Режим просмотра'}
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
          readOnly={readOnly || mode === 'off'}
          baseStartMin={baseAxis?.startMin ?? null}
          baseEndMin={baseAxis?.endMin ?? null}
          onChange={onWindowChange}
        />

        <div className={[styles.section, readOnly ? styles.sectionLocked : ''].filter(Boolean).join(' ')}>
          <span className={styles.sectionTitle}>Область правила</span>
          <div className={styles.chips}>
            <button
              type="button"
              className={[styles.chip, scopeMain ? styles.chipOn : ''].filter(Boolean).join(' ')}
              disabled={readOnly}
              onClick={() => chooseScope(true, null)}
              title="Основное расписание (все дни, база)"
            >
              Все
            </button>
            <button
              type="button"
              className={[styles.chip, !scopeMain && sameDays(weekdays, WEEKDAY_DAYS) ? styles.chipOn : '']
                .filter(Boolean)
                .join(' ')}
              disabled={readOnly}
              onClick={() => chooseScope(false, WEEKDAY_DAYS)}
            >
              Будни
            </button>
            <button
              type="button"
              className={[styles.chip, !scopeMain && sameDays(weekdays, WEEKEND_DAYS) ? styles.chipOn : '']
                .filter(Boolean)
                .join(' ')}
              disabled={readOnly}
              onClick={() => chooseScope(false, WEEKEND_DAYS)}
            >
              Сб, Вс
            </button>
            <span className={styles.divider} />
            <button type="button" className={styles.chip} disabled title="Торговый календарь MOEX — позже">
              <CalendarIcon className={styles.chipIcon} />
              MOEX
            </button>
          </div>
          <div className={styles.days}>
            {WEEKDAYS.map((w) => (
              <button
                key={w.dow}
                type="button"
                className={[styles.day, !scopeMain && weekdays.has(w.dow) ? styles.dayOn : '']
                  .filter(Boolean)
                  .join(' ')}
                disabled={readOnly || scopeMain}
                onClick={() => toggleDay(w.dow)}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        <div className={[styles.section, readOnly ? styles.sectionLocked : ''].filter(Boolean).join(' ')}>
          <span className={styles.sectionTitle}>Режим</span>
          <div className={styles.chips}>
            <button
              type="button"
              className={[styles.chip, mode === 'window' ? styles.chipOn : ''].filter(Boolean).join(' ')}
              disabled={readOnly}
              onClick={() => setMode('window')}
            >
              Окно связи
            </button>
            <button
              type="button"
              className={[styles.chip, mode === 'off' ? styles.chipOn : ''].filter(Boolean).join(' ')}
              disabled={readOnly}
              onClick={() => setMode('off')}
              title="Нерабочий период (не подключаться)"
            >
              Выключено
            </button>
          </div>
        </div>

        <div
          className={[styles.section, readOnly || mode === 'off' ? styles.sectionLocked : '']
            .filter(Boolean)
            .join(' ')}
        >
          <span className={styles.sectionTitle}>Шаблоны (подсказки)</span>
          <div className={styles.chips}>
            {TEMPLATES.map((tpl) => {
              const w = pickWindow(presets[tpl.id], dayType);
              const canApply = w != null && (shiftHours == null || isShiftValid(w, shiftHours));
              return (
                <button
                  key={tpl.id}
                  type="button"
                  className={[styles.chip, activeTemplate === tpl.id ? styles.chipOn : '']
                    .filter(Boolean)
                    .join(' ')}
                  disabled={readOnly || mode === 'off' || !canApply}
                  onClick={() => applyTemplate(tpl, shiftHours)}
                >
                  {tpl.label}
                </button>
              );
            })}
            <span className={styles.divider} />
            {SHIFTS.map((n) => (
              <button
                key={n}
                type="button"
                className={[styles.chip, shiftHours === n ? styles.chipOn : ''].filter(Boolean).join(' ')}
                disabled={readOnly || mode === 'off' || !isShiftValid(activeWin, n)}
                onClick={() => selectShift(n)}
              >
                {n === 0 ? 'Shift 0' : String(n)}
              </button>
            ))}
          </div>
          {activeTplWin && (
            <span className={styles.meta}>
              Из market_schedule ·{' '}
              <span className={dayType === 'weekday' ? styles.metaActive : undefined}>
                будни {fmtWindow(activeTplWin.wd)}
              </span>
              {' · '}
              <span className={dayType === 'weekend' ? styles.metaActive : undefined}>
                выходные {activeTplWin.we ? fmtWindow(activeTplWin.we) : 'нет торгов'}
              </span>
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

        <WeeklyScheduleOverview
          rules={rules}
          preview={editing ? preview : null}
          onCancelRule={editing ? onCancelRule : undefined}
        />

        {history.length > 0 && (
          <section className={styles.history}>
            <h4>История</h4>
            <ul>
              {history.slice(0, 12).map((h) => (
                <li key={h.scheduleId}>
                  <span>
                    {h.mode === 'off'
                      ? 'выкл'
                      : h.open
                        ? `${h.open.slice(0, 5)}–${(h.end ?? '').slice(0, 5)}`
                        : '—'}{' '}
                    · {h.scopeKind}
                    {h.closeReason ? ` · ${h.closeReason}` : ''}
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
