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
 * I2 whitelist: фазовые тики схлопываются / обновляются на месте
 * («попытка 1/5»→«2/5», fail 1/5→5/5, «4 c»→«19 c»). Остальное — discrete.
 * Ключ фазы — (corr, code, status): разные коды в одной нити (reconnecting + connect_failed)
 * живут параллельно и схлопываются независимо.
 */
export function isI2PhaseTick(evt: NotificationEvent): boolean {
  switch (evt.code) {
    case 'connection.recovering':
    case 'connection.connecting':
    case 'connection.connect_failed':
    case 'backend.unavailable.progress':
      return true;
    case 'connection.reconnecting':
      return dataSender(evt) !== 'user';
    default:
      return evt.code.endsWith('.progress');
  }
}

/** Фаза I2 внутри нити: одна строка на (corr, code, status). */
export function i2PhaseKey(corr: string, code: string, status: NotificationStatus): string {
  return `${corr}\u0000${code}\u0000${status}`;
}

/**
 * Проекция raw → лента с I2.
 * Обход newest-first (порядок ленты не ломаем при равном ts); на фазу —
 * id первого (oldest) тика, message/data/ts с новейшего.
 */
export function collapsePhaseTicksView(
  eventsNewestFirst: readonly NotificationEvent[],
): NotificationEvent[] {
  const newestFirst = sortNewestFirstByTs(eventsNewestFirst);
  const phaseTicks = new Map<string, NotificationEvent[]>();

  for (const e of newestFirst) {
    if (!e.correlationId || !isI2PhaseTick(e)) {
      continue;
    }
    const phase = i2PhaseKey(e.correlationId, e.code, resolveStatus(e));
    const list = phaseTicks.get(phase);
    if (list) {
      list.push(e);
    } else {
      phaseTicks.set(phase, [e]);
    }
  }

  const foldedByPhase = new Map<string, NotificationEvent>();
  for (const [phase, ticks] of phaseTicks) {
    const newest = ticks[0]!;
    const oldest = ticks[ticks.length - 1]!;
    foldedByPhase.set(phase, {
      ...oldest,
      message: newest.message,
      data: newest.data,
      ts: newest.ts,
    });
  }

  // Вставляем схлопнутую фазу на месте **oldest** тика (как in-place I2),
  // чтобы обновление текста не поднимало строку над более новыми discrete-событиями.
  const result: NotificationEvent[] = [];
  for (const e of newestFirst) {
    if (!e.correlationId || !isI2PhaseTick(e)) {
      result.push(e);
      continue;
    }
    const phase = i2PhaseKey(e.correlationId, e.code, resolveStatus(e));
    const ticks = phaseTicks.get(phase)!;
    const oldest = ticks[ticks.length - 1]!;
    if (e.id !== oldest.id) {
      continue;
    }
    result.push(foldedByPhase.get(phase)!);
  }
  return result;
}

/**
 * Framework-agnostic шина уведомлений.
 * Хост создаёт экземпляр (или держит singleton) и кормит события из любого источника
 * (локальные действия, WS, REST-бэклог, другой сервис).
 *
 * Raw-буфер всегда полный (как в БД/бэклоге). Лента (`events` / `events$`) — проекция:
 * при {@link setCollapsePhaseTicks}(true) тики I2 объединяются (default).
 */
export class NotificationBus {
  private readonly limit: number;
  /** Полный audit (newest-first), без I2. */
  private raw: NotificationEvent[] = [];
  private collapsePhaseTicksEnabled: boolean;
  private readonly eventsSubject: BehaviorSubject<NotificationEvent[]>;
  private readonly readIds = new Set<string>();

  /**
   * Плоский audit для UI (newest-first). Стабильная ссылка.
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
    this.collapsePhaseTicksEnabled = options.collapsePhaseTicks !== false;
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

  /** Снимок ленты (с учётом схлопывания тиков). */
  get events(): NotificationEvent[] {
    return this.eventsSubject.value;
  }

  /** Снимок raw-аудита без I2 (для отладки / тестов). */
  get rawEvents(): NotificationEvent[] {
    return this.raw;
  }

  /** Сейчас включено ли объединение прогресс-тиков. */
  get collapsePhaseTicks(): boolean {
    return this.collapsePhaseTicksEnabled;
  }

  /**
   * Settings «Объединять прогресс-тики». Default on.
   * Переключение пересобирает ленту из raw без повторного hydrate.
   */
  setCollapsePhaseTicks(enabled: boolean): void {
    if (this.collapsePhaseTicksEnabled === enabled) {
      return;
    }
    this.collapsePhaseTicksEnabled = enabled;
    this.emitDisplay();
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
   * Пакетная подача в **raw** (бэклог / WS). Дедуп по `id`, лимит кольца.
   * I2 применяется только в проекции ленты, если {@link collapsePhaseTicks} включён.
   */
  publishMany(incoming: readonly NotificationEvent[]): void {
    if (incoming.length === 0) {
      return;
    }
    const seen = new Set(this.raw.map((e) => e.id));
    const additions: NotificationEvent[] = [];
    const replacements = new Map<string, NotificationEvent>();
    for (const evt of incoming) {
      if (!evt?.id) {
        continue;
      }
      if (seen.has(evt.id)) {
        replacements.set(evt.id, evt);
        continue;
      }
      seen.add(evt.id);
      additions.push(evt);
    }
    if (additions.length === 0 && replacements.size === 0) {
      return;
    }
    let combined = additions.length > 0 ? [...additions, ...this.raw] : [...this.raw];
    if (replacements.size > 0) {
      combined = combined.map((e) => replacements.get(e.id) ?? e);
    }
    this.raw = sortNewestFirstByTs(combined).slice(0, this.limit);
    this.emitDisplay();
  }

  clear(): void {
    this.readIds.clear();
    this.raw = [];
    this.eventsSubject.next([]);
  }

  /** Убрать событие из raw/ленты (локальный фейк до hydrate — crash-dispatch D5). */
  remove(id: string): boolean {
    if (!id) {
      return false;
    }
    const next = this.raw.filter((e) => e.id !== id);
    if (next.length === this.raw.length) {
      return false;
    }
    this.raw = next;
    this.readIds.delete(id);
    this.emitDisplay();
    return true;
  }

  /** Убрать все атомы soft-deleted эпизода (journal SoT → NC live). */
  removeByCorrelationId(correlationId: string): number {
    if (!correlationId) {
      return 0;
    }
    const next = this.raw.filter((e) => e.correlationId !== correlationId);
    const removed = this.raw.length - next.length;
    if (removed === 0) {
      return 0;
    }
    for (const e of this.raw) {
      if (e.correlationId === correlationId) {
        this.readIds.delete(e.id);
      }
    }
    this.raw = next;
    this.emitDisplay();
    return removed;
  }

  markRead(id: string): void {
    if (this.readIds.has(id)) {
      return;
    }
    this.readIds.add(id);
    this.emitDisplay();
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
      this.emitDisplay();
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

  private emitDisplay(): void {
    const display = this.collapsePhaseTicksEnabled
      ? collapsePhaseTicksView(this.raw)
      : this.raw;
    this.pruneReadIds(this.raw);
    this.eventsSubject.next(display);
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
