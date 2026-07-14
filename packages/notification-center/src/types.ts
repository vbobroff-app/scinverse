/** Уровень важности события. */
export type NotificationSeverity = 'info' | 'warning' | 'critical' | 'error';

/** Источник события: действие оператора / система / внешний контур. */
export type NotificationSourceType = 'user' | 'system' | 'external';

/**
 * Единый контракт уведомления.
 * `ts` — ISO-8601 (хранение UTC/абсолютное); отображение форматирует хост.
 * Сообщения и data не должны содержать секреты (login/password/токены).
 */
export interface NotificationEvent {
  id: string;
  ts: string;
  severity: NotificationSeverity;
  sourceType: NotificationSourceType;
  /** Логический модуль-источник, напр. `ohs.recording`, `connector.transaq`. */
  module: string;
  /** Стабильный машинный код для фильтров, напр. `recording.started`. */
  code: string;
  /** Человекочитаемое сообщение (RU/локаль хоста). */
  message: string;
  data?: Record<string, unknown>;
  correlationId?: string;
}

export const NOTIFICATION_SEVERITIES: readonly NotificationSeverity[] = [
  'info',
  'warning',
  'critical',
  'error',
] as const;

export const NOTIFICATION_SOURCE_TYPES: readonly NotificationSourceType[] = [
  'user',
  'system',
  'external',
] as const;

/** Фильтр ленты (все активные плашки работают как И). */
export interface NotificationFilter {
  severities?: ReadonlySet<NotificationSeverity> | NotificationSeverity[];
  sourceTypes?: ReadonlySet<NotificationSourceType> | NotificationSourceType[];
  modules?: ReadonlySet<string> | string[];
  /** Подстрока по message / code / module (без учёта регистра). */
  query?: string;
}

export interface NotificationBusOptions {
  /** Максимум событий в ring-buffer (новые вытесняют старые). По умолчанию 1000. */
  limit?: number;
}
