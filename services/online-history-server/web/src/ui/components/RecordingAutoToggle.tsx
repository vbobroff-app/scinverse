import { StatusSwitch, type SwitchPhase } from './StatusSwitch';

export type AutoPhase = Extract<SwitchPhase, 'off' | 'waiting' | 'active' | 'connecting'>;

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
      onToggle={() => (phase === 'off' ? onEnable() : onDisable())}
    />
  );
}

/**
 * Фаза Auto (голубой определяется ФАКТОМ записи, а не оценкой сессии на фронте — бэкенд-Supervisor
 * решает старт по календарю FORTS):
 * - голубой (active) — реально пишет (сессия/темп сделок не важны);
 * - жёлтый (connecting) — нет связи («жду связи») либо в сессии, но ещё не стартовал;
 * - зелёный (waiting) — есть связь, вне сессии: «всё ок, включу по расписанию».
 */
export function autoPhase(args: {
  autoEnabled: boolean;
  inSession: boolean;
  recording: boolean;
  connectionReady: boolean;
}): AutoPhase {
  if (!args.autoEnabled) {
    return 'off';
  }
  if (args.recording && args.connectionReady) {
    return 'active';
  }
  if (!args.connectionReady) {
    return 'connecting';
  }
  if (args.inSession) {
    return 'connecting';
  }
  return 'waiting';
}
