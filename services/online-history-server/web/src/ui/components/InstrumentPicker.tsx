import { memo, useCallback, useMemo, type CSSProperties } from 'react';
import { useOhsStore } from '../context';
import { useBehavior } from '../hooks/useObservable';
import { useNow } from '../hooks/useNow';
import { useVirtualRows } from '../hooks/useVirtualRows';
import { Button } from './Button';
import { TimeAxis } from './TimeAxis';
import { CoverageTrack } from './CoverageTrack';
import type { CoverageWindow } from '../../core/OhsStore';
import type { ConnectionDto, CoverageSegmentDto, InstrumentDto } from '../../core/types';
import styles from './InstrumentPicker.module.css';

const ROW_HEIGHT = 48;
const EMPTY_SEGMENTS: CoverageSegmentDto[] = [];

interface RowProps {
  instrument: InstrumentDto;
  window: CoverageWindow;
  segments: CoverageSegmentDto[];
  sourceCodeById: Map<number, string>;
  recording: boolean;
  connected: boolean;
  selected: boolean;
  onToggleSelect: (instrumentId: number) => void;
  onStart: (instrumentId: number) => void;
  onStop: (instrumentId: number) => void;
}

const Row = memo(function Row({
  instrument,
  window,
  segments,
  sourceCodeById,
  recording,
  connected,
  selected,
  onToggleSelect,
  onStart,
  onStop,
}: RowProps) {
  const tradeable = instrument.active;

  return (
    <div className={styles.rowWrap} style={{ height: ROW_HEIGHT }}>
      <div className={[styles.left, tradeable ? '' : styles.inactive].filter(Boolean).join(' ')}>
        <button
          className={[styles.star, selected ? styles.starOn : ''].filter(Boolean).join(' ')}
          onClick={() => onToggleSelect(instrument.instrumentId)}
          title={selected ? 'Убрать из выбранных' : 'Добавить в выбранные'}
          aria-pressed={selected}
        >
          {selected ? '★' : '☆'}
        </button>

        <div className={styles.info}>
          <span className={styles.ticker}>{instrument.ticker}</span>
          <span className={styles.meta}>
            {instrument.board}
            {instrument.secType ? ` · ${instrument.secType}` : ''}
            {!tradeable && <span className={styles.notTrading}>не торгуется</span>}
          </span>
        </div>

        {recording ? (
          <Button variant="danger" onClick={() => onStop(instrument.instrumentId)}>
            Стоп
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!connected || !tradeable}
            onClick={() => onStart(instrument.instrumentId)}
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

  const nowPct = useMemo(() => {
    const fromMs = Date.parse(window.from);
    const span = Math.max(1, Date.parse(window.to) - fromMs);
    return Math.min(100, Math.max(0, ((now - fromMs) / span) * 100));
  }, [now, window]);

  const onNearEnd = useCallback(() => store.loadMoreInstruments(), [store]);
  const virtual = useVirtualRows(instruments.length, ROW_HEIGHT, { overscan: 8, onNearEnd });

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
  const visible = instruments.slice(virtual.start, virtual.end);

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
        {visible.map((inst) => {
          const rec = recordingByInstrument.get(inst.instrumentId);
          const recordingHere = rec != null && rec.connectionId === connection.connectionId;
          return (
            <Row
              key={inst.instrumentId}
              instrument={inst}
              window={window}
              segments={segmentsByInstrument.get(inst.instrumentId) ?? EMPTY_SEGMENTS}
              sourceCodeById={sourceCodeById}
              recording={recordingHere}
              connected={connected}
              selected={selected.has(inst.instrumentId)}
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
