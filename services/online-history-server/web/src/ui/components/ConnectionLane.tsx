import { useMemo, useState, type CSSProperties } from 'react';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { useNow } from '../hooks/useNow';
import { makeProjector } from '../../core/sessionProjection';
import { hasLiveRules, isConnectedNow } from '../../core/connectionSchedule';
import type { ConnectionDto } from '../../core/types';
import { ConnectionAutoToggle, connectionAutoPhase } from './ConnectionAutoToggle';
import { ConnectionRibbon } from './ConnectionRibbon';
import { ConnectionSchedulePopover } from './ConnectionSchedulePopover';
import styles from './ConnectionLane.module.css';

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
  const connectionSchedules = useBehavior(store.connectionSchedule$);
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
  });

  const nowPct = useMemo(
    () => makeProjector(Date.parse(window.from), Date.parse(window.to), sessions)(now),
    [now, window, sessions],
  );
  const laneStyle = { '--now-pct': nowPct } as unknown as CSSProperties;

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
        <div className={styles.right}>
          <ConnectionRibbon
            window={window}
            sessions={sessions}
            intervals={link.intervals}
            gaps={link.gaps}
            nowMs={now}
            tzOffsetMin={tzOffsetMin}
          />
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
