import type { DockRangeFilter, RangeBounds } from './filter/dateRange';

/** Уровень важности / тип сообщения. */
export type NotificationSeverity = 'ok' | 'info' | 'warning' | 'critical' | 'error';

/**
 * Источник события (legacy).
 * Предпочтительно задавать `interaction` + `localization`; при отсутствии
 * выводятся из `sourceType` (user→user/internal, system→system/internal, external→system/external).
 */
export type NotificationSourceType = 'user' | 'system' | 'external';

/** Взаимодействие: кто/что инициировалo событие. */
export type NotificationInteraction = 'user' | 'system' | 'resolving';

/** Локализация контура: внутренний сервис vs внешний. */
export type NotificationLocalization = 'internal' | 'external';

/**
 * Жизненный цикл инцидента (ось B, ортогональна read-state). Отсутствие ⇒ `active`.
 * `active` — условие есть; `underway` — идёт восстановление (реконнект/догрузка);
 * `resolved` — терминальный (рецидив после него = новый `correlationId`).
 */
export type NotificationStatus = 'active' | 'underway' | 'resolved';

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
  /** Взаимодействие; если нет — выводится из sourceType. */
  interaction?: NotificationInteraction;
  /** Локализация; если нет — выводится из sourceType. */
  localization?: NotificationLocalization;
  /** Жизненный цикл инцидента (ось B); если нет — трактуется как `active`. */
  status?: NotificationStatus;
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
  'ok',
  'info',
  'warning',
  'error',
  'critical',
] as const;

export const NOTIFICATION_SOURCE_TYPES: readonly NotificationSourceType[] = [
  'user',
  'system',
  'external',
] as const;

export const NOTIFICATION_INTERACTIONS: readonly NotificationInteraction[] = [
  'user',
  'system',
  'resolving',
] as const;

export const NOTIFICATION_LOCALIZATIONS: readonly NotificationLocalization[] = [
  'internal',
  'external',
] as const;

export const NOTIFICATION_STATUSES: readonly NotificationStatus[] = [
  'active',
  'underway',
  'resolved',
] as const;

/** Фильтр ленты (все активные плашки работают как И). */
export interface NotificationFilter {
  severities?: ReadonlySet<NotificationSeverity> | NotificationSeverity[];
  /** @deprecated предпочитайте interactions + localizations */
  sourceTypes?: ReadonlySet<NotificationSourceType> | NotificationSourceType[];
  interactions?: ReadonlySet<NotificationInteraction> | NotificationInteraction[];
  localizations?: ReadonlySet<NotificationLocalization> | NotificationLocalization[];
  statuses?: ReadonlySet<NotificationStatus> | NotificationStatus[];
  modules?: ReadonlySet<string> | string[];
  /** Подстрока по message / code / module (без учёта регистра). */
  query?: string;
  /** Диапазон по `ts`: пресет DockRangeFilter или готовые границы RangeBounds. */
  range?: DockRangeFilter | RangeBounds;
}

export interface NotificationBusOptions {
  /** Максимум событий в ring-buffer (новые вытесняют старые). По умолчанию 1000. */
  limit?: number;
}

/** Резолв interaction с учётом legacy sourceType. */
export function resolveInteraction(event: NotificationEvent): NotificationInteraction {
  if (event.interaction) {
    return event.interaction;
  }
  return event.sourceType === 'user' ? 'user' : 'system';
}

/** Резолв localization с учётом legacy sourceType. */
export function resolveLocalization(event: NotificationEvent): NotificationLocalization {
  if (event.localization) {
    return event.localization;
  }
  return event.sourceType === 'external' ? 'external' : 'internal';
}

/** Статус инцидента; отсутствие ⇒ `active`. */
export function resolveStatus(event: NotificationEvent): NotificationStatus {
  return event.status ?? 'active';
}
