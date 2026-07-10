// DTO зеркалом Scinverse.Ohs.Contracts (camelCase JSON). См. docs/dev/phase7/apply.md.

export interface InstrumentDto {
  instrumentId: number;
  ticker: string;
  board: string;
  secType: string | null;
  shortName: string | null;
  name: string | null;
  minStep: number;
  decimals: number;
  active: boolean;
  recording: boolean;
  hasOptions: boolean;
  strike: number | null;
  optionType: string | null;
  expiration: string | null;
}

export interface InstrumentPage {
  items: InstrumentDto[];
  total: number;
  limit: number;
  offset: number;
}

/** Узел дерева каталога: серия опционов (экспирация) фьючерса. */
export interface InstrumentGroupDto {
  key: string;
  label: string;
  count: number;
  expiration: string | null;
  /** Нотификатор типа серии: W1..W5 | M1..M12 | Q1..Q4. */
  badge: string | null;
}

export interface InstrumentQueryParams {
  q?: string;
  board?: string;
  secType?: string;
  category?: string;
  onlyRecording?: boolean;
  underlyingId?: number;
  expiration?: string;
  limit: number;
  offset: number;
}

export interface SourceDto {
  sourceId: number;
  code: string;
  name: string | null;
}

/** Торговая сессия MOEX: дата и границы (ISO со смещением +03:00 МСК). */
export interface SessionDto {
  date: string;
  start: string;
  end: string;
  weekend: boolean;
}

/** Границы покрытия данными (для таймфрейма All). */
export interface CoverageExtentDto {
  from: string | null;
  to: string | null;
}

/** Единица посессионных таймфреймов. */
export type TimeframeUnit = 'D' | 'W' | 'M' | 'Q' | 'Y';

/**
 * Выбранный горизонт Ганта.
 * - `sessions` — последние N сессий (D/W) или календарный сдвиг (M/Q/Y);
 * - `all` — от самого раннего сегмента покрытия;
 * - `range` — фиксированный диапазон дат (без live-сдвига).
 */
export type Timeframe =
  | { kind: 'sessions'; unit: TimeframeUnit; count: number; includeWeekends: boolean }
  | { kind: 'all' }
  | { kind: 'range'; from: string; to: string; includeWeekends: boolean };

export interface GapDto {
  from: string;
  to: string;
}

export interface CoverageSegmentDto {
  segmentId: number;
  instrumentId: number;
  sourceId: number;
  from: string;
  to: string | null;
  tradeCount: number;
  status: string;
  gaps: GapDto[];
}

export interface RecordingDto {
  instrumentId: number;
  ticker: string;
  board: string;
  sourceId: number;
  connectionId: number;
  segmentId: number;
  startedAt: string;
  tradeCount: number;
}

export interface StartRecordingRequest {
  instrumentId: number;
  connectionId: number;
}

export interface ConnectionDto {
  connectionId: number;
  sourceId: number;
  name: string;
  kind: string;
  settings: string;
  enabled: boolean;
  status: string;
}

export interface UpsertConnectionRequest {
  sourceId: number;
  name: string;
  kind: string;
  settings: string;
  enabled: boolean;
}

export interface ConnectionCredentialsRequest {
  login: string;
  password: string;
}

// Live-события WebSocket `/ws` (дискриминатор — поле `type`).
export type LiveEvent =
  | { type: 'recordingStarted'; instrumentId: number; sourceId: number; connectionId: number; segmentId: number }
  | { type: 'recordingStopped'; instrumentId: number }
  | { type: 'coverageExtended'; instrumentId: number; sourceId: number; to: string; tradeCount: number }
  | { type: 'connectionStatusChanged'; connectionId: number; status: string };
