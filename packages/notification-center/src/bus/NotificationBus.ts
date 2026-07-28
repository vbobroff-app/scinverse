import { BehaviorSubject, type Observable } from 'rxjs';
import { map, distinctUntilChanged } from 'rxjs/operators';
import { resolveStatus } from '../types';
import type {
  NotificationBusOptions,
  NotificationEvent,
  NotificationItem,
  NotificationStatus,
} from '../types';
import { projectThreads } from './projectThreads';

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

function dataSender(evt: NotificationEvent): string | undefined {
  const s = evt.data?.sender;
  return typeof s === 'string' ? s : undefined;
}

/**
 * I2 whitelist: прогресс-тики схлопываются / обновляются на месте
 * («попытка 1/5»→«2/5», «4 c»→«19 c»). Остальное — discrete.
 */
function isI2PhaseTick(evt: NotificationEvent): boolean {
  switch (evt.code) {
    case 'connection.recovering':
    case 'connection.connecting': // auto-серия «подключаю по расписанию, попытка k/5»
    case 'backend.unavailable.progress':
      return true;
    case 'connection.reconnecting':
      // attempt k/5 супервизора — тик; «по команде оператора» (sender=user) — discrete.
      return dataSender(evt) !== 'user';
    default:
      // Прочие `*.progress` (тики длительности).
      return evt.code.endsWith('.progress');
  }
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

  /**
   * Плоский audit (newest-first по `ts`). Стабильная ссылка.
   * Для UI контейнеров — `items$`; `stream$` сохраняем для совместимости.
   */
  readonly stream$: Observable<NotificationEvent[]>;

  /** Плоский audit — то же, что `stream$` (to-threads §5.2). */
  readonly events$: Observable<NotificationEvent[]>;

  /** Проекция Single | Thread для UI (to-threads §5.2). */
  readonly items$: Observable<NotificationItem[]>;

  /** Число непрочитанных error/critical. Стабильная ссылка. */
  readonly unreadAlertCount$: Observable<number>;

  /** Число непрочитанных warning. Стабильная ссылка. */
  readonly unreadWarningCount$: Observable<number>;

  constructor(options: NotificationBusOptions = {}) {
    this.limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
    this.eventsSubject = new BehaviorSubject<NotificationEvent[]>([]);
    this.stream$ = this.eventsSubject.asObservable();
    this.events$ = this.stream$;
    this.items$ = this.eventsSubject.pipe(map((events) => projectThreads(events)));
    this.unreadAlertCount$ = this.eventsSubject.pipe(
      map((events) => this.countUnread(events, isAlert)),
      distinctUntilChanged(),
    );
    this.unreadWarningCount$ = this.eventsSubject.pipe(
      map((events) => this.countUnread(events, isWarning)),
      distinctUntilChanged(),
    );
  }

  /** Снимок плоского audit. */
  get events(): NotificationEvent[] {
    return this.eventsSubject.value;
  }

  /** Снимок проекции контейнеров Single | Thread. */
  get items(): NotificationItem[] {
    return projectThreads(this.eventsSubject.value);
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
   * I2 только для прогресс-тиков ({@link isI2PhaseTick}): повтор того же `(corr, code, status)`
   * обновляет строку на месте («4 c» → «19 c»). Остальные коды — каждая доставка = новая строка.
   */
  publishMany(incoming: readonly NotificationEvent[]): void {
    if (incoming.length === 0) {
      return;
    }
    const current = this.eventsSubject.value;
    const seen = new Set(current.map((e) => e.id));
    // Последний тик на correlationId — сид из буфера (newest-first: первый = последний).
    const lastTickByCorr = new Map<string, { status: NotificationStatus; code: string }>();
    for (const e of current) {
      if (e.correlationId && isI2PhaseTick(e) && !lastTickByCorr.has(e.correlationId)) {
        lastTickByCorr.set(e.correlationId, { status: resolveStatus(e), code: e.code });
      }
    }
    const additions: NotificationEvent[] = [];
    // Повтор с тем же id (adopt 500: client ts + stackSeq) — заменяем поля, не дропаем.
    const replacements = new Map<string, NotificationEvent>();
    // Прогресс-обновления «на месте»: correlationId → последнее событие того же (status, code).
    const updates = new Map<string, NotificationEvent>();
    for (const evt of incoming) {
      if (!evt?.id) {
        continue;
      }
      if (seen.has(evt.id)) {
        replacements.set(evt.id, evt);
        continue;
      }
      if (evt.correlationId && isI2PhaseTick(evt)) {
        const status = resolveStatus(evt);
        const prev = lastTickByCorr.get(evt.correlationId);
        if (prev && prev.status === status && prev.code === evt.code) {
          // I2: тик — обновляем строку на месте.
          updates.set(evt.correlationId, evt);
          seen.add(evt.id);
          continue;
        }
        lastTickByCorr.set(evt.correlationId, { status, code: evt.code });
      }
      seen.add(evt.id);
      additions.push(evt);
    }
    if (additions.length === 0 && updates.size === 0 && replacements.size === 0) {
      return;
    }
    // Сначала additions (новее по ingest), затем current — при равном `ts` стабильный sort сохранит это.
    let combined = additions.length > 0 ? [...additions, ...current] : [...current];
    if (replacements.size > 0) {
      combined = combined.map((e) => replacements.get(e.id) ?? e);
    }
    if (updates.size > 0) {
      // Обновляем первую (newest-first) строку-тик с совпадающими correlationId + code + status.
      const applied = new Set<string>();
      combined = combined.map((e) => {
        if (!e.correlationId || !isI2PhaseTick(e) || applied.has(e.correlationId)) {
          return e;
        }
        const u = updates.get(e.correlationId);
        if (u && e.code === u.code && resolveStatus(e) === resolveStatus(u)) {
          applied.add(e.correlationId);
          return { ...e, message: u.message, data: u.data, ts: u.ts };
        }
        return e;
      });
    }
    // Newest-first по `ts`, не по порядку вставки. Иначе после reload backdated `open` (POST при resolve,
    // ts = момент дропа) оказывается новее `warning` в буфере — warning «убегает» вниз стека
    // (nc-availability.md §9.5: open+warning+resolve персистятся в разном insert-порядке).
    combined = sortNewestFirstByTs(combined);
    // Одна (новейшая) строка на тик-фазу; non-tick коды не трогаем.
    combined = this.dedupIncidentPhases(combined);
    const next = combined.slice(0, this.limit);
    this.pruneReadIds(next);
    this.eventsSubject.next(next);
  }

  /**
   * Одна (новейшая) строка на `(correlationId, code, status)` только для I2-тиков.
   * Open/resolve/FATAL/connect/… — не трогаем.
   */
  private dedupIncidentPhases(events: readonly NotificationEvent[]): NotificationEvent[] {
    const seenPhase = new Set<string>();
    const result: NotificationEvent[] = [];
    for (const e of events) {
      if (!e.correlationId || !isI2PhaseTick(e)) {
        result.push(e);
        continue;
      }
      const key = `${e.correlationId}\u0000${e.code}\u0000${resolveStatus(e)}`;
      if (seenPhase.has(key)) {
        continue;
      }
      seenPhase.add(key);
      result.push(e);
    }
    return result;
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

/** Newest-first по `ts`. При равном `ts` — стабильный порядок (новее по ingest остаётся выше). */
function sortNewestFirstByTs(events: readonly NotificationEvent[]): NotificationEvent[] {
  return events
    .map((e, index) => ({ e, index, ms: Date.parse(e.ts) }))
    .sort((a, b) => {
      const tb = Number.isFinite(b.ms) ? b.ms : 0;
      const ta = Number.isFinite(a.ms) ? a.ms : 0;
      if (tb !== ta) {
        return tb - ta;
      }
      return a.index - b.index;
    })
    .map(({ e }) => e);
}

export function createNotificationBus(options?: NotificationBusOptions): NotificationBus {
  return new NotificationBus(options);
}
