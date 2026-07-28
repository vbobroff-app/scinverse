import { StatusSwitch } from './StatusSwitch';
import type { AutoPhase } from './recordingAutoPhase';

interface Props {
  phase: AutoPhase;
  onEnable: () => void;
  onDisable: () => void;
}

const LABEL: Record<AutoPhase, string> = {
  off: 'Auto',
  waiting: 'Auto',
  active: 'Auto',
  connecting: 'Auto',
};

const TITLE: Record<AutoPhase, string> = {
  off: 'Автозапись выкл',
  waiting: 'Автозапись: всё ок, включу по сессии MOEX',
  active: 'Автозапись: пишет',
  connecting: 'Автозапись: жду связи',
};

/** Switcher автозаписи: зелёный=вооружён, голубой=пишет, жёлтый=ждёт связи. */
export function RecordingAutoToggle({ phase, onEnable, onDisable }: Props) {
  return (
    <StatusSwitch
      phase={phase}
      label={LABEL[phase]}
      title={TITLE[phase]}
      layout="stacked"
      onToggle={() => (phase === 'off' ? onEnable() : onDisable())}
    />
  );
}
