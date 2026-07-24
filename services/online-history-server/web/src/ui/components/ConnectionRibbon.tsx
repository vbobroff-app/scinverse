import { memo } from 'react';
import type { CoverageWindow } from '../../core/OhsStore';
import { livenessEndMs } from '../../core/coverageGeometry';
import { makeProjector } from '../../core/sessionProjection';
import type { CaptureGapDto, LivenessIntervalDto, SessionDto } from '../../core/types';
import styles from './ConnectionRibbon.module.css';

interface Props {
  window: CoverageWindow;
  sessions?: SessionDto[];
  /** Интервалы «сервер работает» (голубое) на подключение (source). */
  intervals?: LivenessIntervalDto[];
  /** Периоды «связь не жива»: потеря связи (жёлтый) / недоступность бэка (красный) / отключено (серый). */
  gaps?: CaptureGapDto[];
  /** Текущее время (ms) — правый край открытого интервала связи. */
  nowMs?: number;
  /** Смещение отображаемого ТЗ от UTC (мин) — для подписи времени в тултипах. */
  tzOffsetMin?: number;
}

/** Инцидент (после него рисуем зелёный шов «связь восстановлена»); `disconnected` — не инцидент. */
const INCIDENT_CAUSES = new Set(['server_down', 'ping_failed', 'interrupted']);

const CAUSE_LABEL: Record<string, string> = {
  disconnected: 'Отключено',
  scheduled: 'Плановое отключение по расписанию',
  server_down: 'Обрыв связи (сервер не отвечает)',
  ping_failed: 'Связь потеряна (пинг)',
  interrupted: 'Прервано (краш/рестарт бэка)',
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function hhmm(ms: number, offMin: number): string {
  const d = new Date(ms + offMin * 60_000);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/**
 * Класс периода «связь не жива» по причине:
 * - `interrupted` (краш/останов бэка) → красный: недоступен сам коннектор;
 * - `server_down`/`ping_failed` → жёлтый: коннектор жив, но сервер не отвечает (напр. Финам ночью рвёт);
 * - `disconnected` (отключил пользователь) / `scheduled` (плановое по расписанию) → серый: не инцидент.
 */
function gapClass(cause: string): string {
  if (cause === 'interrupted') return styles.down;
  if (cause === 'disconnected' || cause === 'scheduled') return styles.idle;
  return styles.lost;
}

/**
 * Лента Connection (phase 7h.8): жизненный цикл связи одного подключения на общей с инструментами оси.
 * Знает всю историю связи (в т.ч. вне записи). Проекция на инструмент («слушаю ∩ связь лежит») — второй заход.
 */
export const ConnectionRibbon = memo(function ConnectionRibbon({
  window,
  sessions,
  intervals,
  gaps,
  nowMs,
  tzOffsetMin = 180,
}: Props) {
  const windowFromMs = Date.parse(window.from);
  const windowToMs = Date.parse(window.to);
  const liveEdgeMs = Math.min(nowMs ?? windowToMs, windowToMs);
  const pct = makeProjector(windowFromMs, windowToMs, sessions);

  return (
    <div className={styles.track}>
      <span className={styles.nowLine} />

      {intervals?.map((liv, i) => {
        const from = Date.parse(liv.from);
        const to = livenessEndMs(liv, liveEdgeMs, windowToMs);
        const left = pct(from);
        return (
          <div
            key={`c${i}`}
            className={[styles.bar, styles.connected, liv.open ? styles.live : ''].filter(Boolean).join(' ')}
            style={{ left: `${left}%`, width: `${Math.max(0.3, pct(to) - left)}%` }}
            title={`Сервер работает · ${hhmm(from, tzOffsetMin)}–${liv.open ? 'сейчас' : hhmm(to, tzOffsetMin)}`}
          />
        );
      })}

      {gaps?.map((gap, i) => {
        const from = Date.parse(gap.from);
        const to = gap.to ? Date.parse(gap.to) : liveEdgeMs;
        const left = pct(from);
        const label = CAUSE_LABEL[gap.cause] ?? gap.cause;
        return (
          <div
            key={`g${i}`}
            className={[styles.bar, gapClass(gap.cause)].join(' ')}
            style={{ left: `${left}%`, width: `${Math.max(0.3, pct(to) - left)}%` }}
            title={`${label} · ${hhmm(from, tzOffsetMin)}–${gap.to ? hhmm(to, tzOffsetMin) : 'сейчас'}`}
          />
        );
      })}

      {/* Восстановление связи после инцидента — зелёный шов на конце разрыва (момент возврата). */}
      {gaps?.map((gap, i) =>
        gap.to && INCIDENT_CAUSES.has(gap.cause) ? (
          <span
            key={`r${i}`}
            className={styles.recover}
            style={{ left: `${pct(Date.parse(gap.to))}%` }}
            title={`Связь восстановлена · ${hhmm(Date.parse(gap.to), tzOffsetMin)}`}
          />
        ) : null,
      )}
    </div>
  );
});
