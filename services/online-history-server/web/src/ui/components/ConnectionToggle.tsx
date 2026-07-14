import { StatusSwitch, type SwitchPhase } from './StatusSwitch';

interface Props {
  status: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onCancelConnect?: () => void;
}

function toPhase(status: string): SwitchPhase {
  switch (status) {
    case 'active':
      return 'active';
    case 'waiting':
    case 'connected':
      return 'waiting';
    case 'degraded':
      return 'degraded';
    case 'connecting':
    case 'disconnecting':
      return 'connecting';
    case 'error':
      return 'error';
    default:
      return 'off';
  }
}

const LABEL: Record<SwitchPhase, string> = {
  off: 'Отключён',
  connecting: 'Подключение…',
  active: 'Подключён',
  waiting: 'Подключён',
  degraded: 'Восстановление…',
  error: 'Ошибка',
};

export function ConnectionToggle({ status, onConnect, onDisconnect, onCancelConnect }: Props) {
  const phase = toPhase(status);
  const connected = phase === 'active' || phase === 'waiting' || phase === 'degraded';
  const busy = phase === 'connecting';

  const toggle = () => {
    if (busy) {
      onCancelConnect?.();
      return;
    }
    if (connected) {
      onDisconnect();
    } else {
      onConnect();
    }
  };

  return <StatusSwitch phase={phase} label={LABEL[phase]} onToggle={toggle} />;
}
