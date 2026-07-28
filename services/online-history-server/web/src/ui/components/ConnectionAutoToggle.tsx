import { StatusSwitch, type SwitchPhase } from './StatusSwitch';

export type ConnectionAutoPhase = Extract<
  SwitchPhase,
  'off' | 'waiting' | 'active' | 'connecting' | 'error' | 'unreachable'
>;

interface Props {
  phase: ConnectionAutoPhase;
  disabled?: boolean;
  onEnable: () => void;
  onDisable: () => void;
}

const TITLE: Record<ConnectionAutoPhase, string> = {
  off: 'Auto связи выкл',
  waiting: 'Auto: вооружён, включу по расписанию',
  active: 'Auto: связь поднята по расписанию',
  connecting: 'Auto: подключаю / жду связи',
  error: 'Auto: не удалось подключить (см. уведомления)',
  unreachable: 'Auto: OHS недоступен — намерение сохранено',
};

/** Auto соединения (phase 7j): управляет верхним тумблером связи по окну. */
export function ConnectionAutoToggle({ phase, disabled, onEnable, onDisable }: Props) {
  return (
    <StatusSwitch
      phase={phase}
      label="Auto"
      title={disabled ? 'Сначала утвердите расписание' : TITLE[phase]}
      layout="stacked"
      disabled={disabled || phase === 'unreachable'}
      onToggle={() => {
        if (disabled || phase === 'unreachable') {
          return;
        }
        if (phase === 'off') {
          onEnable();
        } else {
          onDisable();
        }
      }}
    />
  );
}

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
