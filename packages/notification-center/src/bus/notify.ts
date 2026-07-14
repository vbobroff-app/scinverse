import { createNotificationId } from '../id';
import type { NotificationBus } from './NotificationBus';
import type { NotificationEvent, NotificationSeverity, NotificationSourceType } from '../types';

export interface NotifyInput {
  module: string;
  code: string;
  message: string;
  sourceType?: NotificationSourceType;
  data?: Record<string, unknown>;
  correlationId?: string;
  id?: string;
  ts?: string;
}

function publishSeverity(
  bus: NotificationBus,
  severity: NotificationSeverity,
  input: NotifyInput,
): NotificationEvent {
  const event: NotificationEvent = {
    id: input.id ?? createNotificationId(),
    ts: input.ts ?? new Date().toISOString(),
    severity,
    sourceType: input.sourceType ?? 'system',
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
  info: (bus: NotificationBus, input: NotifyInput) => publishSeverity(bus, 'info', input),
  warn: (bus: NotificationBus, input: NotifyInput) => publishSeverity(bus, 'warning', input),
  error: (bus: NotificationBus, input: NotifyInput) => publishSeverity(bus, 'error', input),
  critical: (bus: NotificationBus, input: NotifyInput) => publishSeverity(bus, 'critical', input),
};
