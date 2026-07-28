import type { SwitchPhase } from './StatusSwitch';

export type AutoPhase = Extract<SwitchPhase, 'off' | 'waiting' | 'active' | 'connecting'>;

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
