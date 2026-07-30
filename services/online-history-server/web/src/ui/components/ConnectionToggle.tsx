import { StatusSwitch, type SwitchPhase } from './StatusSwitch';

interface Props {
  status: string;
  /** Crash-outage open: жёлтый «OHS недоступен», клик disabled. */
  ohsUnavailable?: boolean;
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
  degraded: 'Связь потеряна…',
  error: 'Ошибка',
  unreachable: 'OHS недоступен',
};

export function ConnectionToggle({
  status,
  ohsUnavailable,
  onConnect,
  onDisconnect,
  onCancelConnect,
}: Props) {
  const phase: SwitchPhase = ohsUnavailable ? 'unreachable' : toPhase(status);
  const connected = phase === 'active' || phase === 'waiting' || phase === 'degraded';
  const busy = phase === 'connecting';

  const toggle = () => {
    if (phase === 'unreachable') {
      return;
    }
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

  return (
    <StatusSwitch
      phase={phase}
      label={LABEL[phase]}
      title={
        ohsUnavailable
          ? 'Нет связи с OHS Host — статус соединения неизвестен'
          : LABEL[phase]
      }
      disabled={ohsUnavailable}
      onToggle={toggle}
    />
  );
}
