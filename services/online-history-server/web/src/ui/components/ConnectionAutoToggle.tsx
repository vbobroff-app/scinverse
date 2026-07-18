import { StatusSwitch, type SwitchPhase } from './StatusSwitch';

export type ConnectionAutoPhase = Extract<SwitchPhase, 'off' | 'waiting' | 'active' | 'connecting' | 'error'>;

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
};

/** Auto соединения (phase 7j): управляет верхним тумблером связи по окну. */
export function ConnectionAutoToggle({ phase, disabled, onEnable, onDisable }: Props) {
  return (
    <StatusSwitch
      phase={phase}
      label="Auto"
      title={disabled ? 'Сначала утвердите расписание' : TITLE[phase]}
      layout="stacked"
      onToggle={() => {
        if (disabled) {
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
}): ConnectionAutoPhase {
  if (!args.autoEnabled) {
    return 'off';
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
