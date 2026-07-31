import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { useElementWidth } from '../hooks/useElementWidth';
import { useNow } from '../hooks/useNow';
import { makeProjector } from '../../core/sessionProjection';
import { hasLiveRules, isConnectedNow } from '../../core/connectionSchedule';
import type { ConnectionDto } from '../../core/types';
import { ConnectionAutoToggle } from './ConnectionAutoToggle';
import { connectionAutoPhase } from './connectionAutoPhase';
import { buildRulerTicks, resolveRulerHover } from './connectionRuler';
import { ConnectionRibbon } from './ConnectionRibbon';
import { ConnectionSchedulePopover } from './ConnectionSchedulePopover';
import styles from './ConnectionLane.module.css';

interface RulerTipState {
  /** X относительно .right (для position:absolute). */
  leftPx: number;
  label: string;
}

/**
 * Панель соединения над фильтром каталога: лейбл + авто-свитч + «Расписание» слева,
 * лента link/gaps справа на общей с Гантом оси времени.
 */
export function ConnectionLane({ connection }: { connection: ConnectionDto }) {
  const store = useOhsStore();
  const link = useBehavior(store.link$);
  const window = useBehavior(store.window$);
  const sessions = useBehavior(store.sessions$);
  const tzOffsetMin = useBehavior(store.displayTz$).offsetMin;
  const showNowMarker = useBehavior(store.showNowMarker$);
  const showLinkRibbon = useBehavior(store.showLinkRibbon$);
  const showIncidents = useBehavior(store.showIncidents$);
  const showScheduleMask = useBehavior(store.showScheduleMask$);
  const connectionSchedules = useBehavior(store.connectionSchedule$);
  const ohsUnavailable = useBehavior(store.backendOutage$);
  const now = useNow(1000);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const connSchedule = connectionSchedules.get(connection.connectionId);
  const rules = useMemo(() => connSchedule?.rules ?? [], [connSchedule]);
  const hasRules = hasLiveRules(rules);
  const connInWindow = useMemo(
    () => (hasRules ? isConnectedNow(rules, new Date(now)) : false),
    [rules, hasRules, now],
  );
  const connAutoPhase = connectionAutoPhase({
    autoEnabled: connSchedule?.settings.autoEnabled ?? false,
    connectionStatus: connection.status,
    inWindow: connInWindow,
    ohsUnavailable,
  });

  const nowPct = useMemo(
    () => makeProjector(Date.parse(window.from), Date.parse(window.to), sessions)(now),
    [now, window, sessions],
  );
  const laneStyle = { '--now-pct': nowPct } as unknown as CSSProperties;

  const rightRef = useRef<HTMLDivElement>(null);
  const [rulerRef, rulerWidth] = useElementWidth<HTMLDivElement>();
  const [rulerTip, setRulerTip] = useState<RulerTipState | null>(null);
  const fromMs = Date.parse(window.from);
  const toMs = Date.parse(window.to);
  const rulerTicks = useMemo(
    () => buildRulerTicks(rulerWidth, fromMs, toMs, sessions, tzOffsetMin),
    [rulerWidth, fromMs, toMs, sessions, tzOffsetMin],
  );

  const onRulerMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const ruler = rulerRef.current;
      const right = rightRef.current;
      if (!ruler || !right) {
        return;
      }
      const rRect = ruler.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      const x = Math.min(Math.max(0, e.clientX - rRect.left), rRect.width);
      const leftPct = rRect.width > 0 ? (x / rRect.width) * 100 : 0;
      const hover = resolveRulerHover(leftPct, rRect.width, fromMs, toMs, sessions, tzOffsetMin);
      setRulerTip({ leftPx: e.clientX - rightRect.left, label: hover.label });
    },
    [rulerRef, fromMs, toMs, sessions, tzOffsetMin],
  );

  return (
    <>
      <div className={styles.lane} style={laneStyle}>
        <div className={styles.left}>
          <span className={styles.name}>Связь · {connection.name}</span>
          <div className={styles.controls}>
            <ConnectionAutoToggle
              phase={connAutoPhase}
              disabled={!hasRules}
              onEnable={() => {
                if (!hasRules) {
                  setScheduleOpen(true);
                  return;
                }
                store.setConnectionAuto(connection.connectionId, true);
              }}
              onDisable={() => store.setConnectionAuto(connection.connectionId, false)}
            />
            <button
              type="button"
              className={styles.scheduleBtn}
              onClick={() => setScheduleOpen(true)}
              title="Расписание соединения"
            >
              Расписание
            </button>
          </div>
        </div>
        <div className={styles.right} ref={rightRef}>
          <ConnectionRibbon
            window={window}
            sessions={sessions}
            intervals={link.intervals}
            gaps={link.gaps}
            incidents={link.incidents}
            nowMs={now}
            tzOffsetMin={tzOffsetMin}
            linkRecoverGraceSeconds={link.linkRecoverGraceSeconds}
            showNowMarker={showNowMarker}
            showLinkRibbon={showLinkRibbon}
            showIncidents={showIncidents}
            showScheduleMask={showScheduleMask}
            scheduleRules={rules}
          />
          <div
            className={styles.ruler}
            ref={rulerRef}
            onMouseEnter={onRulerMove}
            onMouseMove={onRulerMove}
            onMouseLeave={() => setRulerTip(null)}
          >
            {rulerTicks.map((t, i) => (
              <span
                key={`tick${i}`}
                className={[styles.tick, t.major ? styles.tickMajor : styles.tickMinor].join(' ')}
                style={{ left: `${t.left}%` }}
              >
                <span className={styles.tickMark} />
              </span>
            ))}
          </div>
          {rulerTip ? (
            <div
              className={styles.rulerTip}
              style={{ left: rulerTip.leftPx }}
              role="tooltip"
            >
              {rulerTip.label}
            </div>
          ) : null}
        </div>
      </div>

      <ConnectionSchedulePopover
        connectionId={connection.connectionId}
        state={connSchedule}
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onApplyBatch={(args, handlers) =>
          store.applyConnectionScheduleBatch(connection.connectionId, args, handlers)
        }
      />
    </>
  );
}
