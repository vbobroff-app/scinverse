import styles from './ConnectionToggle.module.css';

type Phase = 'off' | 'connecting' | 'active' | 'waiting' | 'error';

interface Props {
  status: string;
  onConnect: () => void;
  onDisconnect: () => void;
}

function toPhase(status: string): Phase {
  switch (status) {
    case 'active':
      return 'active';
    case 'waiting':
    case 'connected':
      return 'waiting';
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
  error: 'Ошибка',
};

export function ConnectionToggle({ status, onConnect, onDisconnect }: Props) {
  const phase = toPhase(status);
  const connected = phase === 'active' || phase === 'waiting';
  const busy = phase === 'connecting';

  const toggle = () => {
    if (busy) {
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
        disabled={busy}
        className={[styles.track, styles[phase]].join(' ')}
        onClick={toggle}
        title={LABEL[phase]}
      >
        <span className={styles.knob}>{connected || busy ? '' : '×'}</span>
      </button>
    </div>
  );
}
