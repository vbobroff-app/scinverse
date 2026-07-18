import { BehaviorSubject, type Observable } from 'rxjs';
import { map, distinctUntilChanged } from 'rxjs/operators';
import { resolveStatus } from '../types';
import type { NotificationBusOptions, NotificationEvent, NotificationStatus } from '../types';

const DEFAULT_LIMIT = 1000;

/** Ключ группировки инцидента: `correlationId`, иначе — сам `id` (одиночное событие). */
function groupKey(evt: NotificationEvent): string {
  return evt.correlationId ?? evt.id;
}

function isAlert(evt: NotificationEvent): boolean {
  return evt.severity === 'error' || evt.severity === 'critical';
}

function isWarning(evt: NotificationEvent): boolean {
  return evt.severity === 'warning';
}

/**
 * Framework-agnostic шина уведомлений.
 * Хост создаёт экземпляр (или держит singleton) и кормит события из любого источника
 * (локальные действия, WS, REST-бэклог, другой сервис).
 */
export class NotificationBus {
  private readonly limit: number;
  private readonly eventsSubject: BehaviorSubject<NotificationEvent[]>;
  private readonly readIds = new Set<string>();

  /** Лента: новые сверху (порядок публикации / ingest). Стабильная ссылка. */
  readonly stream$: Observable<NotificationEvent[]>;

  /** Число непрочитанных error/critical. Стабильная ссылка. */
  readonly unreadAlertCount$: Observable<number>;

  /** Число непрочитанных warning. Стабильная ссылка. */
  readonly unreadWarningCount$: Observable<number>;

  constructor(options: NotificationBusOptions = {}) {
    this.limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
    this.eventsSubject = new BehaviorSubject<NotificationEvent[]>([]);
    this.stream$ = this.eventsSubject.asObservable();
    this.unreadAlertCount$ = this.eventsSubject.pipe(
      map((events) => this.countUnread(events, isAlert)),
      distinctUntilChanged(),
    );
    this.unreadWarningCount$ = this.eventsSubject.pipe(
      map((events) => this.countUnread(events, isWarning)),
      distinctUntilChanged(),
    );
  }

  /** Снимок ленты. */
  get events(): NotificationEvent[] {
    return this.eventsSubject.value;
  }

  get unreadAlertCount(): number {
    return this.countUnread(this.eventsSubject.value, isAlert);
  }

  get unreadWarningCount(): number {
    return this.countUnread(this.eventsSubject.value, isWarning);
  }

  /** Добавить одно событие (дедуп по `id`). */
  publish(event: NotificationEvent): void {
    this.publishMany([event]);
  }

  /**
   * Пакетная подача (бэклог / другой контур). Новые сверху; дедуп по `id`.
   * I2 (lifecycle): для события с `correlationId` строка добавляется только на смену статуса —
   * подряд идущее с тем же `(status, code)` в рамках инцидента пропускается (без спама ленты).
   */
  publishMany(incoming: readonly NotificationEvent[]): void {
    if (incoming.length === 0) {
      return;
    }
    const current = this.eventsSubject.value;
    const seen = new Set(current.map((e) => e.id));
    // Последний известный (status, code) на correlationId — сид из буфера (newest-first: первый = последний).
    const lastByCorr = new Map<string, { status: NotificationStatus; code: string }>();
    for (const e of current) {
      if (e.correlationId && !lastByCorr.has(e.correlationId)) {
        lastByCorr.set(e.correlationId, { status: resolveStatus(e), code: e.code });
      }
    }
    const additions: NotificationEvent[] = [];
    for (const evt of incoming) {
      if (!evt?.id || seen.has(evt.id)) {
        continue;
      }
      if (evt.correlationId) {
        const status = resolveStatus(evt);
        const prev = lastByCorr.get(evt.correlationId);
        if (prev && prev.status === status && prev.code === evt.code) {
          // I2: тот же статус того же инцидента — не плодим строку (но id считаем виденным).
          seen.add(evt.id);
          continue;
        }
        lastByCorr.set(evt.correlationId, { status, code: evt.code });
      }
      seen.add(evt.id);
      additions.push(evt);
    }
    if (additions.length === 0) {
      return;
    }
    // publishMany: сохраняем относительный порядок входящего массива (первое = новее).
    const next = [...additions, ...current].slice(0, this.limit);
    this.pruneReadIds(next);
    this.eventsSubject.next(next);
  }

  clear(): void {
    this.readIds.clear();
    this.eventsSubject.next([]);
  }

  markRead(id: string): void {
    if (this.readIds.has(id)) {
      return;
    }
    this.readIds.add(id);
    // Новый массив — иначе React setState игнорирует тот же reference.
    this.eventsSubject.next([...this.eventsSubject.value]);
  }

  markAllRead(): void {
    let changed = false;
    for (const evt of this.eventsSubject.value) {
      if (!this.readIds.has(evt.id)) {
        this.readIds.add(evt.id);
        changed = true;
      }
    }
    if (changed) {
      this.eventsSubject.next([...this.eventsSubject.value]);
    }
  }

  isRead(id: string): boolean {
    return this.readIds.has(id);
  }

  /** Текущий статус инцидента по `correlationId` (последнее событие группы), либо null. */
  statusOf(correlationId: string): NotificationStatus | null {
    for (const evt of this.eventsSubject.value) {
      if (evt.correlationId === correlationId) {
        return resolveStatus(evt);
      }
    }
    return null;
  }

  /**
   * Счёт непрочитанных по **последнему статусу группы** (`correlationId` / `id`): `resolved` не
   * «горит», перекрытые (не последние) строки инцидента не учитываются. Лента — newest-first,
   * поэтому первое встреченное событие группы и есть её актуальное.
   */
  private countUnread(
    events: readonly NotificationEvent[],
    match: (evt: NotificationEvent) => boolean,
  ): number {
    const seenGroups = new Set<string>();
    let n = 0;
    for (const evt of events) {
      const key = groupKey(evt);
      if (seenGroups.has(key)) {
        continue;
      }
      seenGroups.add(key);
      if (resolveStatus(evt) === 'resolved') {
        continue;
      }
      if (match(evt) && !this.readIds.has(evt.id)) {
        n += 1;
      }
    }
    return n;
  }

  private pruneReadIds(events: readonly NotificationEvent[]): void {
    if (this.readIds.size === 0) {
      return;
    }
    const alive = new Set(events.map((e) => e.id));
    for (const id of [...this.readIds]) {
      if (!alive.has(id)) {
        this.readIds.delete(id);
      }
    }
  }
}

export function createNotificationBus(options?: NotificationBusOptions): NotificationBus {
  return new NotificationBus(options);
}
