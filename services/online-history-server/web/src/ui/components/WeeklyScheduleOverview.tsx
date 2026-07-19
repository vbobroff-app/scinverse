import { useMemo } from 'react';
import type { ConnectionScheduleRuleDto } from '../../core/types';
import { hmsToMin, resolveWinnerForDow } from '../../core/connectionSchedule';
import styles from './WeeklyScheduleOverview.module.css';

/** Предпросмотр текущей правки (ещё не утверждена). */
export interface SchedulePreview {
  scopeKind: string;
  dowMask: number | null;
  mode: string;
  open: string | null;
  durationMin: number | null;
}

interface Props {
  rules: readonly ConnectionScheduleRuleDto[];
  preview?: SchedulePreview | null;
  onCancelRule?: (scheduleId: number) => void;
}

const WEEK: { js: number; label: string }[] = [
  { js: 1, label: 'Пн' },
  { js: 2, label: 'Вт' },
  { js: 3, label: 'Ср' },
  { js: 4, label: 'Чт' },
  { js: 5, label: 'Пт' },
  { js: 6, label: 'Сб' },
  { js: 0, label: 'Вс' },
];

function fmtMin(min: number): string {
  const norm = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(norm / 60);
  const m = norm % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Окно правила как текст (open–end) или «выкл». */
function windowLabel(rule: ConnectionScheduleRuleDto | null): { text: string; kind: 'window' | 'off' | 'none' } {
  if (!rule) return { text: '—', kind: 'none' };
  if (rule.mode === 'off') return { text: 'выкл', kind: 'off' };
  if (rule.open == null || rule.durationMin == null) return { text: '—', kind: 'none' };
  const openMin = hmsToMin(rule.open);
  return { text: `${fmtMin(openMin)}–${fmtMin(openMin + rule.durationMin)}`, kind: 'window' };
}

function scopeLabel(rule: ConnectionScheduleRuleDto): string {
  if (rule.scopeKind === 'main') return 'Основное';
  if (rule.scopeKind === 'date') return `${rule.dateFrom ?? ''}…${rule.dateTo ?? ''}`;
  return maskLabel(rule.dowMask ?? 0);
}

const DOW_SHORT: [number, string][] = [
  [1, 'Пн'],
  [2, 'Вт'],
  [4, 'Ср'],
  [8, 'Чт'],
  [16, 'Пт'],
  [32, 'Сб'],
  [64, 'Вс'],
];

function maskLabel(mask: number): string {
  if (mask === 31) return 'Будни';
  if (mask === 96) return 'Выходные';
  if (mask === 127) return 'Все дни';
  return DOW_SHORT.filter(([bit]) => (mask & bit) !== 0)
    .map(([, l]) => l)
    .join(',');
}

/**
 * Read-only обзор эффективного недельного расписания: строка дней Пн..Вс (что реально
 * применится с учётом приоритетов) + дорожки живых правил с кнопкой «снять» и предпросмотром правки.
 */
export function WeeklyScheduleOverview({ rules, preview, onCancelRule }: Props) {
  // Правила + предпросмотр (как самое свежее правило своего уровня), чтобы показать «что будет».
  const effectiveRules = useMemo<ConnectionScheduleRuleDto[]>(() => {
    const base = [...rules];
    if (preview) {
      base.push({
        scheduleId: -1,
        connectionId: -1,
        scopeKind: preview.scopeKind,
        dowMask: preview.dowMask,
        dateFrom: null,
        dateTo: null,
        mode: preview.mode,
        open: preview.open,
        durationMin: preview.durationMin,
        end: null,
        effectiveFrom: new Date(Date.now() + 60_000).toISOString(),
        effectiveTo: null,
        closeReason: null,
        changeSource: 'preview',
        changeNote: null,
      });
    }
    return base;
  }, [rules, preview]);

  const liveRules = rules;

  return (
    <section className={styles.overview}>
      <div className={styles.weekTitle}>Неделя (эффективно)</div>
      <div className={styles.week}>
        {WEEK.map((d) => {
          const w = windowLabel(resolveWinnerForDow(effectiveRules, d.js));
          return (
            <div key={d.js} className={styles.dayCol}>
              <span className={styles.dayLabel}>{d.label}</span>
              <span className={[styles.dayWin, styles[`kind_${w.kind}`]].join(' ')}>{w.text}</span>
            </div>
          );
        })}
      </div>

      {liveRules.length > 0 && (
        <ul className={styles.lanes}>
          {liveRules.map((r) => {
            const w = windowLabel(r);
            return (
              <li key={r.scheduleId} className={styles.lane}>
                <span className={styles.laneScope}>{scopeLabel(r)}</span>
                <span className={[styles.laneWin, styles[`kind_${w.kind}`]].join(' ')}>{w.text}</span>
                {onCancelRule && r.scopeKind !== 'main' && (
                  <button
                    type="button"
                    className={styles.cancelBtn}
                    onClick={() => onCancelRule(r.scheduleId)}
                    title="Снять правило"
                  >
                    снять
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
