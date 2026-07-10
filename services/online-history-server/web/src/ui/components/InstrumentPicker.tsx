import { memo, useCallback, useMemo, type CSSProperties } from 'react';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { useNow } from '../hooks/useNow';
import { useVirtualRows } from '../hooks/useVirtualRows';
import { Button } from './Button';
import { TimeAxis } from './TimeAxis';
import { CoverageTrack } from './CoverageTrack';
import { seriesKey, type CoverageWindow } from '../../core/OhsStore';
import { exchangeForBoard } from '../../core/exchange';
import type {
  ConnectionDto,
  CoverageSegmentDto,
  InstrumentDto,
  InstrumentGroupDto,
} from '../../core/types';
import styles from './InstrumentPicker.module.css';

const ROW_HEIGHT = 48;
const INDENT = 10;
const EMPTY_SEGMENTS: CoverageSegmentDto[] = [];

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
  sourceCodeById: Map<number, string>;
  recording: boolean;
  connected: boolean;
  selected: boolean;
  expanded: boolean;
  onToggleFutures: (instrument: InstrumentDto) => void;
  onToggleSeries: (futuresId: number, expiration: string) => void;
  onToggleSelect: (instrumentId: number) => void;
  onStart: (instrumentId: number) => void;
  onStop: (instrumentId: number) => void;
}

const Row = memo(function Row({
  row,
  window,
  segments,
  sourceCodeById,
  recording,
  connected,
  selected,
  expanded,
  onToggleFutures,
  onToggleSeries,
  onToggleSelect,
  onStart,
  onStop,
}: RowProps) {
  if (row.kind === 'series') {
    const exp = row.group.expiration ?? row.group.key;
    return (
      <div className={styles.rowWrap} style={{ height: ROW_HEIGHT }}>
        <button
          className={styles.seriesRow}
          style={{ paddingLeft: INDENT }}
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
          <span className={styles.count}>{row.group.count}</span>
        </button>
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
        <CoverageTrack window={window} segments={segments} sourceCodeById={sourceCodeById} />
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
  const sources = useBehavior(store.sources$);
  const selected = useBehavior(store.selectedInstruments$);
  const expandedFutures = useBehavior(store.expandedFutures$);
  const expandedSeries = useBehavior(store.expandedSeries$);
  const seriesByFutures = useBehavior(store.seriesByFutures$);
  const strikesBySeries = useBehavior(store.strikesBySeries$);
  const window = useBehavior(store.window$);
  const now = useNow(1000);

  const connected = connection.status === 'connected';

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

  const nowPct = useMemo(() => {
    const fromMs = Date.parse(window.from);
    const span = Math.max(1, Date.parse(window.to) - fromMs);
    return Math.min(100, Math.max(0, ((now - fromMs) / span) * 100));
  }, [now, window]);

  const onNearEnd = useCallback(() => store.loadMoreInstruments(), [store]);
  const virtual = useVirtualRows(rows.length, ROW_HEIGHT, { overscan: 8, onNearEnd });

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

  const scrollStyle = { '--now-pct': nowPct } as unknown as CSSProperties;
  const visible = rows.slice(virtual.start, virtual.end);

  return (
    <div className={styles.picker}>
      <div className={styles.header}>
        <span className={styles.headLabel}>Инструмент</span>
        <div className={styles.axisCell}>
          <TimeAxis window={window} />
        </div>
      </div>

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
          const expanded =
            row.kind === 'series'
              ? expandedSeries.has(seriesKey(row.futuresId, row.group.expiration ?? row.group.key))
              : row.kind === 'inst'
                ? expandedFutures.has(row.instrument.instrumentId)
                : false;

          return (
            <Row
              key={row.key}
              row={row}
              window={window}
              segments={instrumentId >= 0 ? segmentsByInstrument.get(instrumentId) ?? EMPTY_SEGMENTS : EMPTY_SEGMENTS}
              sourceCodeById={sourceCodeById}
              recording={recordingHere}
              connected={connected}
              selected={instrumentId >= 0 && selected.has(instrumentId)}
              expanded={expanded}
              onToggleFutures={onToggleFutures}
              onToggleSeries={onToggleSeries}
              onToggleSelect={onToggleSelect}
              onStart={onStart}
              onStop={onStop}
            />
          );
        })}
        <div style={{ height: virtual.bottomPad }} />
      </div>

      <div className={styles.footer}>
        {loading ? 'Загрузка…' : `Показано ${instruments.length} из ${total}`}
        {selected.size > 0 ? ` · выбрано ${selected.size}` : ''}
      </div>
    </div>
  );
}
