import type { SwitchPhase } from './StatusSwitch';

export type ConnectionAutoPhase = Extract<
  SwitchPhase,
  'off' | 'waiting' | 'active' | 'connecting' | 'error' | 'unreachable'
>;

export function connectionAutoPhase(args: {
  autoEnabled: boolean;
  connectionStatus: string;
  inWindow: boolean;
  /** Crash-outage open: жёлтый, Auto on не снимаем. */
  ohsUnavailable?: boolean;
}): ConnectionAutoPhase {
  if (!args.autoEnabled) {
    return 'off';
  }
  if (args.ohsUnavailable) {
    return 'unreachable';
  }
  if (args.connectionStatus === 'error') {
    return 'error';
  }
  if (args.connectionStatus === 'waiting' || args.connectionStatus === 'active' || args.connectionStatus === 'degraded') {
    return 'active';
  }
  if (args.connectionStatus === 'connecting' || args.inWindow) {
    return 'connecting';
  }
  return 'waiting';
}
