import styles from './ConnectionToggle.module.css';

type Phase = 'off' | 'connecting' | 'active' | 'waiting' | 'degraded' | 'error';

interface Props {
  status: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onCancelConnect?: () => void;
}

function toPhase(status: string): Phase {
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

const LABEL: Record<Phase, string> = {
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

  return (
    <div className={styles.wrap}>
      <span className={styles.label}>{LABEL[phase]}</span>
      <button
        type="button"
        role="switch"
        aria-checked={connected}
        aria-busy={busy}
        disabled={false}
        className={[styles.track, styles[phase]].join(' ')}
        onClick={toggle}
        title={LABEL[phase]}
      >
        <span className={styles.knob}>{connected || busy ? '' : '×'}</span>
      </button>
    </div>
  );
}
