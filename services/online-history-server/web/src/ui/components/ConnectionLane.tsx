import { Tip } from '@scinverse/notification-center';
import {
  useCallback,
  useEffect,
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
import type { CoverageWindow } from '../../core/OhsStore';
import { makeProjector } from '../../core/sessionProjection';
import { hasLiveRules, isConnectedNow, scheduleButtonKind } from '../../core/connectionSchedule';
import type {
  CaptureGapDto,
  ConnectionDto,
  ConnectionScheduleRuleDto,
  IncidentDto,
  LivenessIntervalDto,
  SessionDto,
} from '../../core/types';
import { ConnectionAutoToggle } from './ConnectionAutoToggle';
import { connectionAutoPhase } from './connectionAutoPhase';
import {
  buildRulerLabelLut,
  buildRulerTicks,
  makeRulerHoverResolver,
} from './connectionRuler';
import {
  buildDaySepPcts,
  createConnectionScrubLayer,
  scrubGeomFromElements,
  type ConnectionScrubLayer,
} from './connectionScrubLayer';
import { ConnectionIncidentsModal } from './ConnectionIncidentsModal';
import { ConnectionRibbon, type RibbonTipHandlers } from './ConnectionRibbon';
import { ConnectionSchedulePopover } from './ConnectionSchedulePopover';
import { BellIcon } from './icons';
import styles from './ConnectionLane.module.css';

interface Geom {
  rightLeft: number;
  rulerLeft: number;
  rulerWidth: number;
}

/** Снимок пропсов ленты — замораживаем на время scrub, чтобы memo Ribbon не пересчитывался. */
interface RibbonSnap {
  coverageWindow: CoverageWindow;
  sessions: SessionDto[];
  intervals: LivenessIntervalDto[];
  gaps: CaptureGapDto[];
  incidents: IncidentDto[] | null | undefined;
  now: number;
  nowPct: number;
  rules: ConnectionScheduleRuleDto[];
  showNowMarker: boolean;
  showLinkRibbon: boolean;
  showBreakIncidents: boolean;
  showCrashIncidents: boolean;
  showWorkGaps: boolean;
  showScheduleMask: boolean;
  tzOffsetMin: number;
  linkRecoverGraceSeconds?: number;
}

/**
 * Панель соединения над фильтром каталога: лейбл + авто-свитч + «Расписание» слева,
 * лента link/gaps справа на общей с Гантом оси времени.
 *
 * Scrub — fixed-слой на document.body (не React). На время scrub пропсы Ribbon заморожены,
 * иначе useNow/link$ блокируют main thread и маркер «догоняет».
 */
export function ConnectionLane({ connection }: { connection: ConnectionDto }) {
  const store = useOhsStore();
  const link = useBehavior(store.link$);
  const coverageWindow = useBehavior(store.window$);
  const sessions = useBehavior(store.sessions$);
  const tzOffsetMin = useBehavior(store.displayTz$).offsetMin;
  const showNowMarker = useBehavior(store.showNowMarker$);
  const showLinkRibbon = useBehavior(store.showLinkRibbon$);
  const showRuler = useBehavior(store.showRuler$);
  const showBreakIncidents = useBehavior(store.showBreakIncidents$);
  const showCrashIncidents = useBehavior(store.showCrashIncidents$);
  const showWorkGaps = useBehavior(store.showWorkGaps$);
  const showScheduleMask = useBehavior(store.showScheduleMask$);
  const connectionSchedules = useBehavior(store.connectionSchedule$);
  const ohsUnavailable = useBehavior(store.backendOutage$);
  const now = useNow(1000);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [incidentsOpen, setIncidentsOpen] = useState(false);
  const [scrubOn, setScrubOn] = useState(false);

  const connSchedule = connectionSchedules.get(connection.connectionId);
  const rules = useMemo(() => connSchedule?.rules ?? [], [connSchedule]);
  const hasRules = hasLiveRules(rules);
  const scheduleBtnKind = useMemo(
    () => scheduleButtonKind(rules, new Date(now)),
    [rules, now],
  );
  /** Колокольчик: active → red, recovering → yellow, иначе green (все resolved / пусто). */
  const bellKind = useMemo(() => {
    const list = link.incidents ?? [];
    if (list.some((i) => i.status === 'active')) {
      return 'active' as const;
    }
    if (list.some((i) => i.status === 'recovering')) {
      return 'recovering' as const;
    }
    return 'resolved' as const;
  }, [link.incidents]);
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
    () =>
      makeProjector(Date.parse(coverageWindow.from), Date.parse(coverageWindow.to), sessions)(now),
    [now, coverageWindow, sessions],
  );

  const liveSnap: RibbonSnap = {
    coverageWindow,
    sessions,
    intervals: link.intervals,
    gaps: link.gaps,
    incidents: link.incidents,
    now,
    nowPct,
    rules,
    showNowMarker,
    showLinkRibbon,
    showBreakIncidents,
    showCrashIncidents,
    showWorkGaps,
    showScheduleMask,
    tzOffsetMin,
    linkRecoverGraceSeconds: link.linkRecoverGraceSeconds,
  };
  const snapRef = useRef(liveSnap);
  if (!scrubOn) {
    snapRef.current = liveSnap;
  }
  /**
   * Scrub: замораживаем link/now (чтобы useNow не дёргал ленту), но горизонт
   * (window/sessions) всегда живой — иначе D2↔D4 обновляет линейку, а гант «стоит».
   */
  const view = scrubOn
    ? {
        ...snapRef.current,
        coverageWindow,
        sessions,
        rules,
        nowPct,
        showNowMarker,
        showLinkRibbon,
        showBreakIncidents,
        showCrashIncidents,
        showWorkGaps,
        showScheduleMask,
        tzOffsetMin,
      }
    : liveSnap;
  const laneStyle = { '--now-pct': view.nowPct } as unknown as CSSProperties;

  const rightRef = useRef<HTMLDivElement>(null);
  const rulerNodeRef = useRef<HTMLDivElement | null>(null);
  const [bindRulerWidth, rulerWidth] = useElementWidth<HTMLDivElement>();
  const rulerRef = useCallback(
    (el: HTMLDivElement | null) => {
      rulerNodeRef.current = el;
      bindRulerWidth(el);
    },
    [bindRulerWidth],
  );
  const tipRef = useRef<HTMLDivElement>(null);
  const scrubRef = useRef<ConnectionScrubLayer | null>(null);
  const scrubOnRef = useRef(false);
  const geomRef = useRef<Geom>({ rightLeft: 0, rulerLeft: 0, rulerWidth: 1 });
  const labelLutRef = useRef<string[]>([]);
  const lastTipLabelRef = useRef('');
  const hoverResolverRef = useRef(makeRulerHoverResolver(0, 1, [], 180, 1));

  const fromMs = Date.parse(coverageWindow.from);
  const toMs = Date.parse(coverageWindow.to);
  const rulerTicks = useMemo(
    () => buildRulerTicks(rulerWidth, fromMs, toMs, sessions, tzOffsetMin),
    [rulerWidth, fromMs, toMs, sessions, tzOffsetMin],
  );

  const hoverResolver = useMemo(
    () => makeRulerHoverResolver(fromMs, toMs, sessions, tzOffsetMin, rulerWidth || 1),
    [fromMs, toMs, sessions, tzOffsetMin, rulerWidth],
  );
  hoverResolverRef.current = hoverResolver;

  useEffect(() => {
    const w = Math.max(1, Math.floor(rulerWidth || 1));
    const lut = buildRulerLabelLut(w, hoverResolver);
    labelLutRef.current = lut;
    scrubRef.current?.setLabels(lut);
  }, [hoverResolver, rulerWidth]);

  useEffect(() => {
    const layer = createConnectionScrubLayer();
    scrubRef.current = layer;
    return () => {
      layer.destroy();
      scrubRef.current = null;
    };
  }, []);

  const syncScrubGeom = useCallback(() => {
    const right = rightRef.current;
    const ruler = rulerNodeRef.current;
    if (!right || !ruler) {
      return;
    }
    const rr = right.getBoundingClientRect();
    const ru = ruler.getBoundingClientRect();
    geomRef.current = {
      rightLeft: rr.left,
      rulerLeft: ru.left,
      rulerWidth: Math.max(1, ru.width),
    };
    scrubRef.current?.syncGeom(scrubGeomFromElements(right, ruler));
  }, []);

  const hideTip = useCallback(() => {
    const el = tipRef.current;
    if (el) {
      el.hidden = true;
    }
    lastTipLabelRef.current = '';
  }, []);

  const showTip = useCallback((label: string, clientX: number) => {
    if (scrubOnRef.current) {
      return;
    }
    const el = tipRef.current;
    if (!el) {
      return;
    }
    el.hidden = false;
    el.style.transform = `translate3d(${clientX - geomRef.current.rightLeft}px,0,0) translateX(-50%)`;
    if (lastTipLabelRef.current !== label) {
      lastTipLabelRef.current = label;
      el.textContent = label;
    }
  }, []);

  const syncScrubDaySeps = useCallback(() => {
    scrubRef.current?.setDaySeps(buildDaySepPcts(fromMs, toMs, sessions, tzOffsetMin));
  }, [fromMs, toMs, sessions, tzOffsetMin]);

  const setScrubActive = useCallback(
    (on: boolean, clientX?: number) => {
      scrubOnRef.current = on;
      setScrubOn(on);
      const layer = scrubRef.current;
      if (!layer) {
        return;
      }
      if (on) {
        hideTip();
        syncScrubGeom();
        layer.setLabels(labelLutRef.current);
        syncScrubDaySeps();
        layer.show(clientX ?? geomRef.current.rulerLeft);
      } else {
        layer.hide();
      }
    },
    [hideTip, syncScrubGeom, syncScrubDaySeps],
  );

  const tipHandlers = useMemo<RibbonTipHandlers>(
    () => ({
      onTip: (label, clientX) => showTip(label, clientX),
      onTipClear: () => hideTip(),
    }),
    [showTip, hideTip],
  );

  const onRulerMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (scrubOnRef.current) {
        return;
      }
      const g = geomRef.current;
      const x = Math.min(Math.max(0, e.clientX - g.rulerLeft), g.rulerWidth);
      const px = Math.min(labelLutRef.current.length - 1, Math.max(0, Math.round(x)));
      const label =
        labelLutRef.current[px] ?? hoverResolverRef.current((x / g.rulerWidth) * 100).label;
      showTip(label, e.clientX);
    },
    [showTip],
  );

  const onRightDoubleClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!showRuler) {
        return;
      }
      e.preventDefault();
      setScrubActive(!scrubOnRef.current, e.clientX);
    },
    [setScrubActive, showRuler],
  );

  useEffect(() => {
    if (!showRuler && scrubOnRef.current) {
      setScrubActive(false);
    }
  }, [showRuler, setScrubActive]);

  /** Смена горизонта (D2↔D4 / D+) — выходим из scrub, иначе day-seps/курсор на старой геометрии. */
  useEffect(() => {
    if (scrubOnRef.current) {
      setScrubActive(false);
    }
  }, [coverageWindow.from, coverageWindow.to, setScrubActive]);

  useEffect(() => {
    if (!scrubOn) {
      return;
    }
    /** Внутри .right — полоска следует; вне — park (пропадает), scrub-режим остаётся. */
    let inside = true;
    const onPointerMove = (e: PointerEvent) => {
      const right = rightRef.current;
      const layer = scrubRef.current;
      if (!right || !layer) {
        return;
      }
      const r = right.getBoundingClientRect();
      const nextInside =
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom;
      if (!nextInside) {
        if (inside) {
          inside = false;
          layer.park();
        }
        return;
      }
      if (!inside) {
        inside = true;
        layer.unpark(e.clientX);
        return;
      }
      layer.move(e.clientX);
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, [scrubOn]);

  useEffect(() => {
    syncScrubGeom();
    if (scrubOnRef.current) {
      syncScrubDaySeps();
    }
  }, [syncScrubGeom, syncScrubDaySeps, rulerWidth, coverageWindow.from, coverageWindow.to]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && scrubOnRef.current) {
        setScrubActive(false);
      }
    };
    const onScrollOrResize = () => {
      syncScrubGeom();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [setScrubActive, syncScrubGeom]);

  return (
    <>
      <div className={styles.lane} style={laneStyle}>
        <div className={styles.left}>
          <span className={styles.name}>Связь · {connection.name}</span>
          <div className={styles.controls}>
            <button
              type="button"
              className={[
                styles.scheduleBtn,
                scheduleBtnKind === 'active' ? styles.scheduleBtnActive : '',
                scheduleBtnKind === 'dateToday' ? styles.scheduleBtnDateToday : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setScheduleOpen(true)}
              title={
                scheduleBtnKind === 'dateToday'
                  ? 'Расписание соединения (сегодня — календарное исключение)'
                  : scheduleBtnKind === 'active'
                    ? 'Расписание соединения'
                    : 'Расписание соединения (не задано)'
              }
            >
              Расписание
            </button>
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
            <Tip
              content={
                bellKind === 'active'
                  ? 'Журнал инцидентов (есть Active)'
                  : bellKind === 'recovering'
                    ? 'Журнал инцидентов (есть Recovering)'
                    : 'Журнал инцидентов'
              }
            >
              <button
                type="button"
                className={[
                  styles.incidentsBtn,
                  bellKind === 'active' ? styles.incidentsBtnActive : '',
                  bellKind === 'recovering' ? styles.incidentsBtnRecovering : '',
                  bellKind === 'resolved' ? styles.incidentsBtnResolved : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setIncidentsOpen(true)}
                aria-label="Журнал инцидентов"
              >
                <BellIcon className={styles.incidentsBtnIcon} />
              </button>
            </Tip>
          </div>
        </div>
        <div
          className={[
            styles.right,
            showRuler ? '' : styles.rightNoRuler,
            scrubOn ? styles.rightScrubOn : '',
          ]
            .filter(Boolean)
            .join(' ')}
          ref={rightRef}
          onDoubleClick={onRightDoubleClick}
          onMouseEnter={syncScrubGeom}
        >
          <ConnectionRibbon
            window={view.coverageWindow}
            sessions={view.sessions}
            intervals={view.intervals}
            gaps={view.gaps}
            incidents={view.incidents}
            nowMs={view.now}
            tzOffsetMin={view.tzOffsetMin}
            linkRecoverGraceSeconds={view.linkRecoverGraceSeconds}
            showNowMarker={view.showNowMarker}
            showLinkRibbon={view.showLinkRibbon}
            showBreakIncidents={view.showBreakIncidents}
            showCrashIncidents={view.showCrashIncidents}
            paintGapsAsIncidents={view.showWorkGaps}
            showScheduleMask={view.showScheduleMask}
            scheduleRules={view.rules}
            tip={tipHandlers}
          />
          {showRuler ? (
            <>
              <div
                className={styles.ruler}
                ref={rulerRef}
                onMouseEnter={(e) => {
                  syncScrubGeom();
                  onRulerMove(e);
                }}
                onMouseMove={onRulerMove}
                onMouseLeave={hideTip}
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
              <div className={styles.rulerTip} ref={tipRef} hidden role="tooltip" />
            </>
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

      <ConnectionIncidentsModal
        connectionId={connection.connectionId}
        connectionName={connection.name}
        open={incidentsOpen}
        onClose={() => setIncidentsOpen(false)}
      />
    </>
  );
}
