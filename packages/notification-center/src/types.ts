import type { DockRangeFilter, RangeBounds } from './filter/dateRange';

/** Уровень важности / тип сообщения. */
export type NotificationSeverity = 'ok' | 'info' | 'warning' | 'critical' | 'error';

/**
 * Источник события (legacy).
 * Предпочтительно задавать `interaction` + `localization`; при отсутствии
 * выводятся из `sourceType` (user→user/internal, system→system/internal, external→system/external).
 */
export type NotificationSourceType = 'user' | 'system' | 'external';

/** Взаимодействие: кто/что инициировалo событие. Жизненный цикл — ось `status`, не здесь. */
export type NotificationInteraction = 'user' | 'system';

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
  /** Квалификатор инцидента без uid (OHS Hub `subject`), для слоя/группировки. */
  subject?: string;
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
  /**
   * Смещение TZ для range (минуты от UTC), как `createOffsetFormatTs`.
   * Должно совпадать с форматтером времени ленты (displayTz хоста).
   */
  tzOffsetMin?: number;
}

export interface NotificationBusOptions {
  /** Максимум событий в ring-buffer (новые вытесняют старые). По умолчанию 1000. */
  limit?: number;
  /** Объединять прогресс-тики I2 в ленте (Settings). Default `true`. Raw всегда полный. */
  collapsePhaseTicks?: boolean;
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

// ─── Object model: Single | Thread (phase 11.8) ─────────────────────────────
// Spec: docs/dev/phase11/to-threads.md

/** Политика нити: Incident (в горизонте расписания) vs Group (вне). */
export type ThreadKind = 'incident' | 'group';

/**
 * Статус **нити** (не severity и не lifecycle-атома `NotificationStatus`).
 * `active` — открыта; `recovering` — идёт восстановление; `resolved` — terminal close.
 */
export type ThreadStatus = 'active' | 'recovering' | 'resolved';

/** Чем закрылся стек (на close-событии в `data.closeOutcome`). */
export type CloseOutcome = 'recovered' | 'abandoned_schedule' | 'abandoned_manual';

export const THREAD_KINDS: readonly ThreadKind[] = ['incident', 'group'] as const;

export const THREAD_STATUSES: readonly ThreadStatus[] = [
  'active',
  'recovering',
  'resolved',
] as const;

export const CLOSE_OUTCOMES: readonly CloseOutcome[] = [
  'recovered',
  'abandoned_schedule',
  'abandoned_manual',
] as const;

/** Клиентские метки ★ / ⊘ (`isLeft` = спам; v1 не в БД). */
export interface NcMarks {
  isFavorite?: boolean;
  isLeft?: boolean;
}

/**
 * Опциональные поля в `NotificationEvent.data` для политики нити.
 * Таблицы DB не меняем — хватает jsonb `data` (to-threads §6.0).
 */
export interface NotificationThreadDataFields {
  /** Hint с бэка на Open: incident | group по горизонту. */
  threadKindHint?: ThreadKind;
  /** Outcome на close-событии. */
  closeOutcome?: CloseOutcome;
}

/** Заголовок Thread в UI (без severity-иконки). */
export interface ThreadHeader {
  title: string;
  summary?: string;
}

/**
 * Single — атом без нити (нет `correlationId`, либо политика не группирует).
 * Инвариант: в ленте контейнеров занимает одну позицию.
 */
export type SingleItem = NotificationEvent &
  NcMarks & {
    readonly itemKind: 'single';
  };

/**
 * Entry — атом внутри Thread (`corr_uid` = `correlationId`).
 * Severity-иконка — на Entry, не на заголовке Thread.
 */
export type EntryItem = NotificationEvent &
  NcMarks & {
    readonly itemKind: 'entry';
    /** = `correlationId` события. */
    corrUid: string;
  };

/**
 * Thread — контейнер по `corr_uid`. База для Incident | Group.
 * Инвариант T1: все Entry имеют один `corrUid`.
 * Инвариант T2: в ленте контейнеров — одна позиция (sortKey = lastActivityAt).
 */
export type ThreadItem = NcMarks & {
  readonly itemKind: 'thread';
  /** = corr_uid */
  uid: string;
  notifications: EntryItem[];
  threadKind: ThreadKind;
  threadStatus: ThreadStatus;
  openedAt: string;
  closedAt?: string;
  /** Рекомендуемый sortKey ленты (to-threads Q2). */
  lastActivityAt: string;
  /** Префикс corr до uid, напр. `connection:{id}:link`. */
  subject?: string;
  closeOutcome?: CloseOutcome;
  header: ThreadHeader;
};

/** Incident ⊂ Thread — открыт в горизонте; обязан закрыться (recovered | abandoned_*). */
export type IncidentItem = ThreadItem & { threadKind: 'incident' };

/** Group ⊂ Thread — вне горизонта; не «журнал инцидентов». */
export type GroupItem = ThreadItem & { threadKind: 'group' };

/** Элемент ленты контейнеров. */
export type NotificationItem = SingleItem | ThreadItem;

export function isSingleItem(item: NotificationItem): item is SingleItem {
  return item.itemKind === 'single';
}

export function isThreadItem(item: NotificationItem): item is ThreadItem {
  return item.itemKind === 'thread';
}

export function isIncidentItem(item: NotificationItem): item is IncidentItem {
  return item.itemKind === 'thread' && item.threadKind === 'incident';
}

export function isGroupItem(item: NotificationItem): item is GroupItem {
  return item.itemKind === 'thread' && item.threadKind === 'group';
}

function isThreadKind(value: unknown): value is ThreadKind {
  return value === 'incident' || value === 'group';
}

function isCloseOutcome(value: unknown): value is CloseOutcome {
  return (
    value === 'recovered' ||
    value === 'abandoned_schedule' ||
    value === 'abandoned_manual'
  );
}

/** Прочитать `data.threadKindHint` с open-события (если бэк уже пишет). */
export function readThreadKindHint(
  data?: Record<string, unknown> | null,
): ThreadKind | undefined {
  if (!data) return undefined;
  const hint = data.threadKindHint;
  return isThreadKind(hint) ? hint : undefined;
}

/** Прочитать `data.closeOutcome` с close-события. */
export function readCloseOutcome(
  data?: Record<string, unknown> | null,
): CloseOutcome | undefined {
  if (!data) return undefined;
  const outcome = data.closeOutcome;
  return isCloseOutcome(outcome) ? outcome : undefined;
}
