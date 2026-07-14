import { BehaviorSubject, type Observable } from 'rxjs';
import { map, distinctUntilChanged } from 'rxjs/operators';
import type { NotificationBusOptions, NotificationEvent } from '../types';

const DEFAULT_LIMIT = 1000;

function isAlert(evt: NotificationEvent): boolean {
  return evt.severity === 'error' || evt.severity === 'critical';
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

  /**
   * Число непрочитанных error/critical.
   * Info/warning не поднимают бейдж (см. phase 11). Стабильная ссылка.
   */
  readonly unreadAlertCount$: Observable<number>;

  constructor(options: NotificationBusOptions = {}) {
    this.limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
    this.eventsSubject = new BehaviorSubject<NotificationEvent[]>([]);
    this.stream$ = this.eventsSubject.asObservable();
    this.unreadAlertCount$ = this.eventsSubject.pipe(
      map((events) => this.countUnreadAlerts(events)),
      distinctUntilChanged(),
    );
  }

  /** Снимок ленты. */
  get events(): NotificationEvent[] {
    return this.eventsSubject.value;
  }

  get unreadAlertCount(): number {
    return this.countUnreadAlerts(this.eventsSubject.value);
  }

  /** Добавить одно событие (дедуп по `id`). */
  publish(event: NotificationEvent): void {
    this.publishMany([event]);
  }

  /** Пакетная подача (бэклог / другой контур). Новые сверху; дедуп по `id`. */
  publishMany(incoming: readonly NotificationEvent[]): void {
    if (incoming.length === 0) {
      return;
    }
    const seen = new Set(this.eventsSubject.value.map((e) => e.id));
    const additions: NotificationEvent[] = [];
    for (const evt of incoming) {
      if (!evt?.id || seen.has(evt.id)) {
        continue;
      }
      seen.add(evt.id);
      additions.push(evt);
    }
    if (additions.length === 0) {
      return;
    }
    // publishMany: сохраняем относительный порядок входящего массива (первое = новее).
    const next = [...additions, ...this.eventsSubject.value].slice(0, this.limit);
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
    this.eventsSubject.next(this.eventsSubject.value);
  }

  markAllRead(): void {
    let changed = false;
    for (const evt of this.eventsSubject.value) {
      if (isAlert(evt) && !this.readIds.has(evt.id)) {
        this.readIds.add(evt.id);
        changed = true;
      }
    }
    if (changed) {
      this.eventsSubject.next(this.eventsSubject.value);
    }
  }

  isRead(id: string): boolean {
    return this.readIds.has(id);
  }

  private countUnreadAlerts(events: readonly NotificationEvent[]): number {
    let n = 0;
    for (const evt of events) {
      if (isAlert(evt) && !this.readIds.has(evt.id)) {
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
