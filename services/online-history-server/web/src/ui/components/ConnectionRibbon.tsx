import { memo } from 'react';
import type { CoverageWindow } from '../../core/OhsStore';
import { livenessEndMs } from '../../core/coverageGeometry';
import { makeProjector } from '../../core/sessionProjection';
import type { CaptureGapDto, LivenessIntervalDto, SessionDto } from '../../core/types';
import { DEFAULT_LINK_RECOVER_GRACE_SEC, resolveEscalatedMs } from './connectionRibbonGaps';
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
  /** T = LinkRecoverGraceSeconds (жёлтое ≤ T). С API `/coverage/link`. */
  linkRecoverGraceSeconds?: number;
}

/** Не-инцидент (серое, без маркеров): отключил оператор / плановое по расписанию. Всё прочее = инцидент. */
const GREY_CAUSES = new Set(['disconnected', 'scheduled']);

function isIncident(cause: string): boolean {
  return !GREY_CAUSES.has(cause);
}

const CAUSE_LABEL: Record<string, string> = {
  disconnected: 'Отключено',
  scheduled: 'Плановое отключение по расписанию',
  degraded: 'Восстановление связи (TRANSAQ)',
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
 * Класс тела по owner break (7j.20 §0a/§4). В DTO owner закодирован причиной фазы:
 * - `degraded` → owner=transaq → жёлтый (ждёт до T, может сдать раньше);
 * - `server_down`/`ping_failed` / фаза после `escalatedAt` → owner=supervisor → красный сплошной;
 * - `interrupted` → crash/admin → красная штриховка;
 * - `disconnected`/`scheduled` → не инцидент → серый.
 */
function gapClass(cause: string): string {
  if (GREY_CAUSES.has(cause)) return styles.idle;
  if (cause === 'degraded') return styles.lost;
  if (cause === 'interrupted') return styles.down;
  return styles.supervisor;
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
  linkRecoverGraceSeconds = DEFAULT_LINK_RECOVER_GRACE_SEC,
}: Props) {
  const windowFromMs = Date.parse(window.from);
  const windowToMs = Date.parse(window.to);
  const liveEdgeMs = Math.min(nowMs ?? windowToMs, windowToMs);
  const pct = makeProjector(windowFromMs, windowToMs, sessions);
  const graceSec =
    linkRecoverGraceSeconds > 0 ? linkRecoverGraceSeconds : DEFAULT_LINK_RECOVER_GRACE_SEC;

  return (
    <div className={styles.track}>
      <span className={styles.nowLine} />

      {intervals?.map((liv, i) => {
        const from = Date.parse(liv.from);
        const to = livenessEndMs(liv, liveEdgeMs, windowToMs);
        // 7j.20/J6: нулевой маркер границы владельца (from==to, закрытый) — не «живой» интервал, не рисуем.
        if (!liv.open && to <= from) return null;
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

      {/* Тело инцидента. При передаче владения (escalatedAt) дырка ОДНА, но красится в две фазы:
          жёлтая [from, escalatedAt] (TRANSAQ) + красная [escalatedAt, to] (супервизор). */}
      {gaps?.flatMap((gap, i) => {
        const from = Date.parse(gap.from);
        const to = gap.to ? Date.parse(gap.to) : liveEdgeMs;
        const label = CAUSE_LABEL[gap.cause] ?? gap.cause;
        const escMs = resolveEscalatedMs(gap, from, to, graceSec);

        if (escMs === null || !isIncident(gap.cause)) {
          const left = pct(from);
          return [
            <div
              key={`g${i}`}
              className={[styles.bar, gapClass(gap.cause)].join(' ')}
              style={{ left: `${left}%`, width: `${Math.max(0.3, pct(to) - left)}%` }}
              title={`${label} · ${hhmm(from, tzOffsetMin)}–${gap.to ? hhmm(to, tzOffsetMin) : 'сейчас'}`}
            />,
          ];
        }

        const leftA = pct(from);
        const leftB = pct(escMs);
        return [
          <div
            key={`g${i}a`}
            className={[styles.bar, gapClass(gap.cause)].join(' ')}
            style={{ left: `${leftA}%`, width: `${Math.max(0.3, leftB - leftA)}%` }}
            title={`${label} · ${hhmm(from, tzOffsetMin)}–${hhmm(escMs, tzOffsetMin)}`}
          />,
          <div
            key={`g${i}b`}
            className={[styles.bar, styles.supervisor].join(' ')}
            style={{ left: `${leftB}%`, width: `${Math.max(0.3, pct(to) - leftB)}%` }}
            title={`Восстановление связи (супервизор) · ${hhmm(escMs, tzOffsetMin)}–${gap.to ? hhmm(to, tzOffsetMin) : 'сейчас'}`}
          />,
        ];
      })}

      {/* Красный стартовый маркер (1px) — момент открытия инцидента (потеря связи). */}
      {gaps?.map((gap, i) =>
        isIncident(gap.cause) ? (
          <span
            key={`s${i}`}
            className={styles.startMarker}
            style={{ left: `${pct(Date.parse(gap.from))}%` }}
            title={`Потеря связи · ${hhmm(Date.parse(gap.from), tzOffsetMin)}`}
          />
        ) : null,
      )}

      {/* Зелёный конечный маркер (1px) — только recovered (Live). abandoned (конец окна) — без маркера. */}
      {gaps?.map((gap, i) =>
        gap.to && isIncident(gap.cause) && !gap.abandoned ? (
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
