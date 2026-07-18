import { createNotificationId } from '../id';
import type { NotificationBus } from './NotificationBus';
import type {
  NotificationEvent,
  NotificationInteraction,
  NotificationLocalization,
  NotificationSeverity,
  NotificationSourceType,
  NotificationStatus,
} from '../types';

export interface NotifyInput {
  module: string;
  code: string;
  message: string;
  sourceType?: NotificationSourceType;
  interaction?: NotificationInteraction;
  localization?: NotificationLocalization;
  status?: NotificationStatus;
  data?: Record<string, unknown>;
  correlationId?: string;
  id?: string;
  ts?: string;
}

function defaultsFromSource(sourceType: NotificationSourceType): {
  interaction: NotificationInteraction;
  localization: NotificationLocalization;
} {
  if (sourceType === 'user') {
    return { interaction: 'user', localization: 'internal' };
  }
  if (sourceType === 'external') {
    return { interaction: 'system', localization: 'external' };
  }
  return { interaction: 'system', localization: 'internal' };
}

function publishSeverity(
  bus: NotificationBus,
  severity: NotificationSeverity,
  input: NotifyInput,
): NotificationEvent {
  const sourceType = input.sourceType ?? 'system';
  const mapped = defaultsFromSource(sourceType);
  const event: NotificationEvent = {
    id: input.id ?? createNotificationId(),
    ts: input.ts ?? new Date().toISOString(),
    severity,
    sourceType,
    interaction: input.interaction ?? mapped.interaction,
    localization: input.localization ?? mapped.localization,
    status: input.status,
    module: input.module,
    code: input.code,
    message: input.message,
    data: input.data,
    correlationId: input.correlationId,
  };
  bus.publish(event);
  return event;
}

/** Сахар над `bus.publish` с автозаполнением id/ts/severity. */
export const notify = {
  ok: (bus: NotificationBus, input: NotifyInput) => publishSeverity(bus, 'ok', input),
  info: (bus: NotificationBus, input: NotifyInput) => publishSeverity(bus, 'info', input),
  warn: (bus: NotificationBus, input: NotifyInput) => publishSeverity(bus, 'warning', input),
  error: (bus: NotificationBus, input: NotifyInput) => publishSeverity(bus, 'error', input),
  critical: (bus: NotificationBus, input: NotifyInput) => publishSeverity(bus, 'critical', input),
};
