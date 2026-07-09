// DTO зеркалом Scinverse.Ohs.Contracts (camelCase JSON). См. docs/dev/phase7/apply.md.

export interface InstrumentDto {
  instrumentId: number;
  ticker: string;
  board: string;
  secType: string | null;
  name: string | null;
  minStep: number;
  decimals: number;
  active: boolean;
  recording: boolean;
}

export interface InstrumentPage {
  items: InstrumentDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface InstrumentQueryParams {
  q?: string;
  board?: string;
  secType?: string;
  onlyRecording?: boolean;
  limit: number;
  offset: number;
}

export interface SourceDto {
  sourceId: number;
  code: string;
  name: string | null;
}

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
