import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { useNow } from '../hooks/useNow';
import { useVirtualRows } from '../hooks/useVirtualRows';
import { Button } from './Button';
import { TimeAxis } from './TimeAxis';
import { TimeframePanel } from './TimeframePanel';
import { CoverageTrack } from './CoverageTrack';
import { CrosshairOverlay } from './CrosshairOverlay';
import { CrosshairIcon, DayBoxIcon } from './icons';
import { showCrosshair, hideCrosshair } from '../../core/crosshair';
import { seriesKey, type CoverageWindow } from '../../core/OhsStore';
import { makeProjector, makeInverseProjector } from '../../core/sessionProjection';
import { exchangeForBoard } from '../../core/exchange';
import type {
  CaptureGapDto,
  ConnectionDto,
  CoverageSegmentDto,
  InstrumentDto,
  InstrumentGroupDto,
  LivenessIntervalDto,
  RecordingDto,
  SessionDto,
} from '../../core/types';
import styles from './InstrumentPicker.module.css';

const ROW_HEIGHT = 50;
const INDENT = 10;
const EMPTY_SEGMENTS: CoverageSegmentDto[] = [];

/** Сегменты дорожки: из coverage или синтетический открытый, пока GET /coverage не догнал запись. */
function trackSegments(
  instrumentId: number,
  segmentsByInstrument: Map<number, CoverageSegmentDto[]>,
  recording: RecordingDto | undefined,
  connection: ConnectionDto,
): CoverageSegmentDto[] {
  const stored = segmentsByInstrument.get(instrumentId);
  if (stored && stored.length > 0) {
    return stored;
  }
  if (!recording || recording.connectionId !== connection.connectionId) {
    return EMPTY_SEGMENTS;
  }
  return [
    {
      segmentId: recording.segmentId,
      instrumentId: recording.instrumentId,
      sourceId: connection.sourceId,
      from: recording.startedAt,
      to: null,
      tradeCount: recording.tradeCount,
      status: 'recording',
      gaps: [],
    },
  ];
}

type TreeRow =
  | { kind: 'inst'; key: string; instrument: InstrumentDto }
  | { kind: 'series'; key: string; futuresId: number; group: InstrumentGroupDto }
  | { kind: 'strike'; key: string; option: InstrumentDto };

function formatExpiration(value: string | null): string {
  if (!value) {
    return '—';
  }
  const [y, m, d] = value.split('-');
  return d && m && y ? `${d}.${m}.${y}` : value;
}

function primaryLabel(inst: InstrumentDto): string {
  return inst.shortName?.trim() || inst.ticker;
}

function badgeKindClass(badge: string): string {
  const kind = badge.charAt(0).toUpperCase();
  return kind === 'W' ? styles.badgeWeekly : kind === 'Q' ? styles.badgeQuarterly : styles.badgeMonthly;
}

function metaParts(inst: InstrumentDto): string {
  const primary = primaryLabel(inst);
  const parts = [exchangeForBoard(inst.board)];
  if (inst.ticker !== primary) {
    parts.unshift(inst.ticker);
  }
  if (inst.secType) {
    parts.push(inst.secType);
  }
  return parts.join(' · ');
}

interface RowProps {
  row: TreeRow;
  window: CoverageWindow;
  segments: CoverageSegmentDto[];
  activityBuckets?: number[];
  activityBucketMs: number;
  activitySourceId: number;
  livenessIntervals?: LivenessIntervalDto[];
  captureGaps?: CaptureGapDto[];
  tzOffsetMin: number;
  sessions: SessionDto[];
  sourceCodeById: Map<number, string>;
  recording: boolean;
  connected: boolean;
  selected: boolean;
  expanded: boolean;
  seriesBusy: boolean;
  seriesRecordingCount: number;
  highlightDays: boolean;
  nowMs: number;
  onToggleFutures: (instrument: InstrumentDto) => void;
  onToggleSeries: (futuresId: number, expiration: string) => void;
  onToggleSelect: (instrumentId: number) => void;
  onStart: (instrumentId: number) => void;
  onStop: (instrumentId: number) => void;
  onStartSeries: (futuresId: number, expiration: string) => void;
  onStopSeries: (futuresId: number, expiration: string) => void;
}

const Row = memo(function Row({
  row,
  window,
  segments,
  activityBuckets,
  activityBucketMs,
  activitySourceId,
  livenessIntervals,
  captureGaps,
  tzOffsetMin,
  sessions,
  sourceCodeById,
  recording,
  connected,
  selected,
  expanded,
  seriesBusy,
  seriesRecordingCount,
  highlightDays,
  nowMs,
  onToggleFutures,
  onToggleSeries,
  onToggleSelect,
  onStart,
  onStop,
  onStartSeries,
  onStopSeries,
}: RowProps) {
  if (row.kind === 'series') {
    const exp = row.group.expiration ?? row.group.key;
    const recCount = seriesRecordingCount;
    return (
      <div className={styles.rowWrap} style={{ height: ROW_HEIGHT }}>
        <div className={styles.seriesRow} style={{ paddingLeft: INDENT }}>
          <button
            className={styles.seriesExpand}
            onClick={() => onToggleSeries(row.futuresId, exp)}
            aria-expanded={expanded}
          >
            <span className={[styles.chevron, expanded ? styles.chevronOpen : ''].filter(Boolean).join(' ')}>
              ▸
            </span>
            <span className={styles.seriesLabel}>{row.group.label}</span>
            {row.group.badge && (
              <span className={[styles.badge, badgeKindClass(row.group.badge)].join(' ')}>
                {row.group.badge}
              </span>
            )}
            <span className={styles.seriesExp}>exp {formatExpiration(row.group.expiration)}</span>
            <span className={styles.count}>
              {recCount > 0 ? `${recCount}/${row.group.count}` : row.group.count}
            </span>
          </button>

          {seriesBusy ? (
            <Button variant="default" disabled>
              …
            </Button>
          ) : recCount > 0 ? (
            <Button variant="danger" onClick={() => onStopSeries(row.futuresId, exp)}>
              Стоп серии
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={!connected}
              onClick={() => onStartSeries(row.futuresId, exp)}
            >
              Старт серии
            </Button>
          )}
        </div>
      </div>
    );
  }

  const isStrike = row.kind === 'strike';
  const inst = isStrike ? row.option : row.instrument;
  const tradeable = inst.active;
  const canExpand = row.kind === 'inst' && inst.hasOptions;

  const label = isStrike
    ? `${inst.optionType === 'C' ? 'Call' : 'Put'} ${inst.strike ?? ''}`.trim()
    : primaryLabel(inst);

  return (
    <div className={styles.rowWrap} style={{ height: ROW_HEIGHT }}>
      <div
        className={[styles.left, tradeable ? '' : styles.inactive].filter(Boolean).join(' ')}
        style={{ marginLeft: isStrike ? INDENT * 2 : 0 }}
      >
        {canExpand ? (
          <button
            className={[styles.chevron, expanded ? styles.chevronOpen : ''].filter(Boolean).join(' ')}
            onClick={() => onToggleFutures(inst)}
            title={expanded ? 'Свернуть опционы' : 'Показать опционы'}
            aria-expanded={expanded}
          >
            ▸
          </button>
        ) : (
          <span className={styles.chevronSpacer} />
        )}

        <div className={styles.info}>
          <span className={styles.ticker}>{label}</span>
          <span className={styles.meta}>
            {metaParts(inst)}
            {!tradeable && <span className={styles.notTrading}>не торгуется</span>}
          </span>
        </div>

        <button
          className={[styles.star, selected ? styles.starOn : ''].filter(Boolean).join(' ')}
          onClick={() => onToggleSelect(inst.instrumentId)}
          title={selected ? 'Убрать из выбранных' : 'Добавить в выбранные'}
          aria-pressed={selected}
        >
          {selected ? '★' : '☆'}
        </button>

        {recording ? (
          <Button variant="danger" onClick={() => onStop(inst.instrumentId)}>
            Стоп
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!connected || !tradeable}
            onClick={() => onStart(inst.instrumentId)}
          >
            Старт
          </Button>
        )}
      </div>

      <div className={styles.right}>
        <CoverageTrack
          window={window}
          segments={segments}
          activityBuckets={activityBuckets}
          activityBucketMs={activityBucketMs}
          activitySourceId={activitySourceId}
          livenessIntervals={livenessIntervals}
          captureGaps={captureGaps}
          tzOffsetMin={tzOffsetMin}
          sourceCodeById={sourceCodeById}
          sessions={sessions}
          highlightDays={highlightDays}
          nowMs={nowMs}
        />
      </div>
    </div>
  );
});

export function InstrumentPicker({ connection }: { connection: ConnectionDto }) {
  const store = useOhsStore();
  const instruments = useBehavior(store.instruments$);
  const total = useBehavior(store.instrumentsTotal$);
  const loading = useBehavior(store.instrumentsLoading$);
  const recordings = useBehavior(store.recordings$);
  const coverage = useBehavior(store.coverage$);
  const activity = useBehavior(store.activity$);
  const liveness = useBehavior(store.liveness$);
  const sources = useBehavior(store.sources$);
  const selected = useBehavior(store.selectedInstruments$);
  const expandedFutures = useBehavior(store.expandedFutures$);
  const expandedSeries = useBehavior(store.expandedSeries$);
  const seriesByFutures = useBehavior(store.seriesByFutures$);
  const strikesBySeries = useBehavior(store.strikesBySeries$);
  const seriesBusy = useBehavior(store.seriesBusy$);
  const window = useBehavior(store.window$);
  const sessions = useBehavior(store.sessions$);
  const tzOffsetMin = useBehavior(store.displayTz$).offsetMin;
  const now = useNow(1000);

  // Подключением считаем оба «живых» статуса: active (идут данные) и waiting (тишина).
  const connected = connection.status === 'active' || connection.status === 'waiting';

  const sourceCodeById = useMemo(
    () => new Map(sources.map((s) => [s.sourceId, s.code])),
    [sources],
  );

  const recordingByInstrument = useMemo(
    () => new Map(recordings.map((r) => [r.instrumentId, r])),
    [recordings],
  );

  const segmentsByInstrument = useMemo(() => {
    const map = new Map<number, CoverageSegmentDto[]>();
    for (const segment of coverage) {
      if (segment.sourceId !== connection.sourceId) {
        continue;
      }
      const list = map.get(segment.instrumentId);
      if (list) {
        list.push(segment);
      } else {
        map.set(segment.instrumentId, [segment]);
      }
    }
    return map;
  }, [coverage, connection.sourceId]);

  // Разворачиваем дерево (фьючерс → серии → страйки) в плоский список видимых строк.
  const rows = useMemo<TreeRow[]>(() => {
    const out: TreeRow[] = [];
    for (const inst of instruments) {
      out.push({ kind: 'inst', key: `i${inst.instrumentId}`, instrument: inst });
      if (!inst.hasOptions || !expandedFutures.has(inst.instrumentId)) {
        continue;
      }
      for (const group of seriesByFutures.get(inst.instrumentId) ?? []) {
        const exp = group.expiration ?? group.key;
        const sKey = seriesKey(inst.instrumentId, exp);
        out.push({ kind: 'series', key: `s${sKey}`, futuresId: inst.instrumentId, group });
        if (!expandedSeries.has(sKey)) {
          continue;
        }
        for (const option of strikesBySeries.get(sKey) ?? []) {
          out.push({ kind: 'strike', key: `o${option.instrumentId}`, option });
        }
      }
    }
    return out;
  }, [instruments, expandedFutures, expandedSeries, seriesByFutures, strikesBySeries]);

  // Слой сделок запрашиваем батчем по всем видимым инструментам дорожки + источнику провайдера.
  const activityIds = useMemo(() => {
    const ids: number[] = [];
    for (const r of rows) {
      if (r.kind === 'inst') {
        ids.push(r.instrument.instrumentId);
      } else if (r.kind === 'strike') {
        ids.push(r.option.instrumentId);
      }
    }
    return ids;
  }, [rows]);

  useEffect(() => {
    store.setActivityContext(activityIds, connection.sourceId);
  }, [store, activityIds, connection.sourceId]);

  const nowPct = useMemo(
    () => makeProjector(Date.parse(window.from), Date.parse(window.to), sessions)(now),
    [now, window, sessions],
  );

  const onNearEnd = useCallback(() => store.loadMoreInstruments(), [store]);
  const virtual = useVirtualRows(rows.length, ROW_HEIGHT, { overscan: 8, onNearEnd });
  const axisCellRef = useRef<HTMLDivElement>(null);
  const [crosshairOn, setCrosshairOn] = useState(true);
  const [highlightDays, setHighlightDays] = useState(false);
  const frameRef = useRef(0);

  const invert = useMemo(
    () => makeInverseProjector(Date.parse(window.from), Date.parse(window.to), sessions),
    [window.from, window.to, sessions],
  );

  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    hideCrosshair();
  }, []);

  useEffect(() => {
    if (!crosshairOn) hideCrosshair();
  }, [crosshairOn]);

  /** Вертикальный time-line по всей колонке Ганта (не только по колбаске). */
  const onPickerPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!crosshairOn) return;
      const axis = axisCellRef.current;
      const scroll = virtual.ref.current;
      if (!axis || !scroll) return;

      const clientX = e.clientX;
      const clientY = e.clientY;
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0;
        const aRect = axis.getBoundingClientRect();
        const sRect = scroll.getBoundingClientRect();
        // Линейка (метки) живёт в контентной части ячейки оси — вычитаем её горизонтальные паддинги,
        // иначе синий time-line рассинхронится с горизонтальной шкалой.
        const cs = getComputedStyle(axis);
        const padL = parseFloat(cs.paddingLeft) || 0;
        const padR = parseFloat(cs.paddingRight) || 0;
        const trackLeft = aRect.left + padL;
        const trackRight = aRect.right - padR;
        const trackWidth = Math.max(1, trackRight - trackLeft);
        const top = sRect.top;
        const bottom = aRect.bottom;

        // Пороги: левый/правый край колонки Ганта, верх скролла, низ оси.
        // Вертикальное движение внутри — не гасит линию (в отличие от leave по каждой колбаске).
        if (clientX < trackLeft || clientX > trackRight || clientY < top || clientY > bottom) {
          hideCrosshair();
          return;
        }

        let pctPos = ((clientX - trackLeft) / trackWidth) * 100;
        if (clientX <= trackLeft + 2) pctPos = 0;
        else if (clientX >= trackRight - 2) pctPos = 100;

        showCrosshair({
          x: clientX,
          trackLeft,
          trackRight,
          ms: invert(pctPos),
          tzOffsetMin,
          atEnd: pctPos >= 100,
        });
      });
    },
    [crosshairOn, invert, tzOffsetMin, virtual.ref],
  );

  const onPickerPointerLeave = useCallback(() => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    hideCrosshair();
  }, []);

  const onToggleFutures = useCallback((inst: InstrumentDto) => store.toggleFutures(inst), [store]);
  const onToggleSeries = useCallback(
    (futuresId: number, expiration: string) => store.toggleSeries(futuresId, expiration),
    [store],
  );
  const onToggleSelect = useCallback(
    (instrumentId: number) => store.toggleInstrumentSelection(instrumentId),
    [store],
  );
  const onStart = useCallback(
    (instrumentId: number) =>
      store.startRecording({ instrumentId, connectionId: connection.connectionId }),
    [store, connection.connectionId],
  );
  const onStop = useCallback((instrumentId: number) => store.stopRecording(instrumentId), [store]);
  const onStartSeries = useCallback(
    (futuresId: number, expiration: string) =>
      store.startSeries(futuresId, expiration, connection.connectionId),
    [store, connection.connectionId],
  );
  const onStopSeries = useCallback(
    (futuresId: number, expiration: string) => store.stopSeries(futuresId, expiration),
    [store],
  );

  const scrollStyle = { '--now-pct': nowPct } as unknown as CSSProperties;
  const visible = rows.slice(virtual.start, virtual.end);

  return (
    <div
      className={[styles.picker, crosshairOn ? styles.pickerCrosshair : ''].filter(Boolean).join(' ')}
      onPointerMove={onPickerPointerMove}
      onPointerLeave={onPickerPointerLeave}
    >
      <div className={styles.scroll} ref={virtual.ref} onScroll={virtual.onScroll} style={scrollStyle}>
        <div style={{ height: virtual.topPad }} />
        {visible.map((row) => {
          const instrumentId =
            row.kind === 'inst'
              ? row.instrument.instrumentId
              : row.kind === 'strike'
                ? row.option.instrumentId
                : -1;
          const rec = instrumentId >= 0 ? recordingByInstrument.get(instrumentId) : undefined;
          const recordingHere = rec != null && rec.connectionId === connection.connectionId;

          let sKey = '';
          let seriesRecordingCount = 0;
          if (row.kind === 'series') {
            sKey = seriesKey(row.futuresId, row.group.expiration ?? row.group.key);
            const strikes = strikesBySeries.get(sKey);
            if (strikes) {
              for (const option of strikes) {
                const r = recordingByInstrument.get(option.instrumentId);
                if (r != null && r.connectionId === connection.connectionId) {
                  seriesRecordingCount += 1;
                }
              }
            }
          }

          const expanded =
            row.kind === 'series'
              ? expandedSeries.has(sKey)
              : row.kind === 'inst'
                ? expandedFutures.has(row.instrument.instrumentId)
                : false;

          return (
            <Row
              key={row.key}
              row={row}
              window={window}
              segments={instrumentId >= 0 ? trackSegments(instrumentId, segmentsByInstrument, rec, connection) : EMPTY_SEGMENTS}
              activityBuckets={instrumentId >= 0 ? activity.byInstrument.get(instrumentId) : undefined}
              activityBucketMs={activity.bucketMs}
              activitySourceId={connection.sourceId}
              livenessIntervals={liveness.intervals}
              captureGaps={liveness.gaps}
              tzOffsetMin={tzOffsetMin}
              sessions={sessions}
              sourceCodeById={sourceCodeById}
              recording={recordingHere}
              connected={connected}
              selected={instrumentId >= 0 && selected.has(instrumentId)}
              expanded={expanded}
              seriesBusy={row.kind === 'series' && seriesBusy.has(sKey)}
              seriesRecordingCount={seriesRecordingCount}
              highlightDays={highlightDays}
              nowMs={now}
              onToggleFutures={onToggleFutures}
              onToggleSeries={onToggleSeries}
              onToggleSelect={onToggleSelect}
              onStart={onStart}
              onStop={onStop}
              onStartSeries={onStartSeries}
              onStopSeries={onStopSeries}
            />
          );
        })}
        <div style={{ height: virtual.bottomPad }} />
      </div>

      <div className={styles.axisBar}>
        <div className={styles.tfCell}>
          <span className={styles.footer}>
            {loading ? 'Загрузка…' : `${instruments.length} из ${total}`}
            {selected.size > 0 ? ` · выбрано ${selected.size}` : ''}
          </span>
          <TimeframePanel />
        </div>
        <div className={styles.axisCell} ref={axisCellRef}>
          <TimeAxis window={window} sessions={sessions} tzOffsetMin={tzOffsetMin} />
        </div>
      </div>

      <button
        type="button"
        className={[styles.dayToggle, highlightDays ? styles.dayToggleOn : ''].filter(Boolean).join(' ')}
        aria-pressed={highlightDays}
        title={highlightDays ? 'Не подсвечивать дни' : 'Подсвечивать дни'}
        onClick={() => setHighlightDays((v) => !v)}
      >
        <DayBoxIcon className={styles.crosshairToggleIcon} />
      </button>

      <button
        type="button"
        className={[styles.crosshairToggle, crosshairOn ? styles.crosshairToggleOn : ''].filter(Boolean).join(' ')}
        aria-pressed={crosshairOn}
        title={crosshairOn ? 'Выключить вертикальный time-line' : 'Включить вертикальный time-line'}
        onClick={() => setCrosshairOn((v) => !v)}
      >
        <CrosshairIcon className={styles.crosshairToggleIcon} />
      </button>

      {crosshairOn && <CrosshairOverlay scrollRef={virtual.ref} axisRef={axisCellRef} />}
    </div>
  );
}
