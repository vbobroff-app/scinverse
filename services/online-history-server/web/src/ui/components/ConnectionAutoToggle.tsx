import { StatusSwitch } from './StatusSwitch';
import type { ConnectionAutoPhase } from './connectionAutoPhase';

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
