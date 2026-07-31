/**
 * Хост phase 11: singleton-шина уведомлений + состояние дока.
 * Пакет `@scinverse/notification-center` не знает про OHS — адаптеры и seed живут здесь.
 */

import { createNotificationBus, notify } from '@scinverse/notification-center';
import type {
  NotificationInteraction,
  NotificationLocalization,
  NotificationSeverity,
  NotificationSourceType,
  NotificationStatus,
} from '@scinverse/notification-center';
import type { ConnectionNeedsOperatorDto, NotificationDto } from './types';

const KNOWN_STATUSES: readonly NotificationStatus[] = ['active', 'underway', 'resolved'];

function toStatus(value: string | null | undefined): NotificationStatus | undefined {
  return value && (KNOWN_STATUSES as readonly string[]).includes(value)
    ? (value as NotificationStatus)
    : undefined;
}

const KNOWN_INTERACTIONS: readonly NotificationInteraction[] = ['user', 'system'];
const KNOWN_LOCALIZATIONS: readonly NotificationLocalization[] = ['internal', 'external'];

function toInteraction(value: string | null | undefined): NotificationInteraction | undefined {
  return value && (KNOWN_INTERACTIONS as readonly string[]).includes(value)
    ? (value as NotificationInteraction)
    : undefined;
}

function toLocalization(value: string | null | undefined): NotificationLocalization | undefined {
  return value && (KNOWN_LOCALIZATIONS as readonly string[]).includes(value)
    ? (value as NotificationLocalization)
    : undefined;
}
import { notificationDockStore } from './notificationDockStorage';

export const notificationBus = createNotificationBus({
  collapsePhaseTicks: notificationDockStore.settings$.value.collapsePhaseTicks,
});

/** Открыт ли док (колокольчик). Источник правды — notificationDockStore (+ localStorage). */
export const notificationDockOpen$ = notificationDockStore.open$;

export function setNotificationDockOpen(open: boolean): void {
  notificationDockStore.setOpen(open);
}

export function toggleNotificationDock(): void {
  notificationDockStore.toggleOpen();
}

/** Демо-лента: все severity × разные interaction / localization (для UI/фильтров). */
function seedDemoNotifications(): void {
  const base = Date.now();
  const ago = (sec: number) => new Date(base - sec * 1000).toISOString();

  notify.ok(notificationBus, {
    id: 'ohs.demo.ok.user',
    ts: ago(90),
    module: 'ohs.recording',
    code: 'recording.started',
    message: 'Запись Si-6.26 запущена',
    interaction: 'user',
    localization: 'internal',
    data: { instrumentId: 101, ticker: 'Si-6.26' },
  });

  notify.info(notificationBus, {
    id: 'ohs.demo.info.system',
    ts: ago(75),
    module: 'ohs.ui',
    code: 'catalog.refreshed',
    message: 'Каталог инструментов обновлён (1247 поз.)',
    interaction: 'system',
    localization: 'internal',
  });

  notify.info(notificationBus, {
    id: 'ohs.demo.info.external',
    ts: ago(60),
    module: 'connector.transaq',
    code: 'connector.connected',
    message: 'TRANSAQ: соединение установлено',
    interaction: 'system',
    localization: 'external',
    data: { host: 'tr1.finam.ru' },
  });

  notify.warn(notificationBus, {
    id: 'ohs.demo.warn.resolving',
    ts: ago(45),
    module: 'ohs.coverage',
    code: 'coverage.gap',
    message: 'Пробел в покрытии M1 · 3 мин — идёт догрузка',
    localization: 'internal',
    status: 'underway',
    correlationId: 'ohs.demo.coverage.gap.sber',
    data: { ticker: 'SBER', gapMin: 3 },
  });

  notify.warn(notificationBus, {
    id: 'ohs.demo.warn.external',
    ts: ago(30),
    module: 'connector.transaq',
    code: 'connector.slow',
    message: 'TRANSAQ: повышенная задержка ответа (1.8 с)',
    interaction: 'system',
    localization: 'external',
  });

  notify.error(notificationBus, {
    id: 'ohs.demo.error.user',
    ts: ago(20),
    module: 'ohs.recording',
    code: 'recording.start.failed',
    message: 'Не удалось запустить запись: инструмент не торгуется',
    interaction: 'user',
    localization: 'internal',
    data: { instrumentId: 55, reason: 'not_trading' },
  });

  notify.error(notificationBus, {
    id: 'ohs.demo.error.external',
    ts: ago(12),
    module: 'connector.transaq',
    code: 'connector.disconnect',
    message: 'TRANSAQ: разрыв соединения, переподключение…',
    interaction: 'system',
    localization: 'external',
  });

  notify.critical(notificationBus, {
    id: 'ohs.demo.critical.system',
    ts: ago(5),
    module: 'ohs.storage',
    code: 'storage.unavailable',
    message: 'TimescaleDB недоступна — запись остановлена',
    interaction: 'system',
    localization: 'internal',
    data: { db: 'ohs' },
  });

  notify.ok(notificationBus, {
    id: 'ohs.demo.ok.resolving',
    ts: ago(2),
    module: 'ohs.coverage',
    code: 'coverage.healed',
    message: 'Пробел закрыт: M1 SBER восстановлен',
    localization: 'internal',
    status: 'resolved',
    correlationId: 'ohs.demo.coverage.gap.sber',
  });
}

// Демо-лента только по явному флагу (иначе после рестарта Host «живые» события
// из ring-buffer пропадают, а фейки остаются и путают приёмку).
// Включить: VITE_NC_DEMO=1 в .env / .env.local и перезапуск Vite.
if (import.meta.env.DEV && import.meta.env.VITE_NC_DEMO === '1') {
  seedDemoNotifications();
}

/** Browser Notification API ↔ настройка «Отправлять в трей». */
function canUseTray(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function showTrayNotification(evt: {
  id: string;
  severity: string;
  message: string;
  module: string;
}): void {
  if (!canUseTray() || Notification.permission !== 'granted') {
    return;
  }
  try {
    const n = new Notification(`[${evt.severity}] ${evt.module}`, {
      body: evt.message,
      tag: evt.id,
    });
    n.onclick = () => {
      window.focus();
      n.close();
      notificationDockStore.setOpen(true);
    };
  } catch {
    /* ignore */
  }
}

/** Запросить разрешение при включении «Отправлять в трей». */
export async function ensureTrayPermission(): Promise<boolean> {
  if (!canUseTray()) {
    return false;
  }
  if (Notification.permission === 'granted') {
    return true;
  }
  if (Notification.permission === 'denied') {
    return false;
  }
  try {
    const result = await Notification.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}

function startTrayBridge(): void {
  if (!canUseTray()) {
    return;
  }
  let known = new Set(notificationBus.events.map((e) => e.id));
  notificationBus.stream$.subscribe((events) => {
    if (!notificationDockStore.settings$.value.sendToTray) {
      known = new Set(events.map((e) => e.id));
      return;
    }
    for (const evt of events) {
      if (known.has(evt.id)) {
        continue;
      }
      if (evt.severity === 'warning' || evt.severity === 'error' || evt.severity === 'critical') {
        showTrayNotification(evt);
      }
    }
    known = new Set(events.map((e) => e.id));
  });
}

startTrayBridge();

/**
 * Бэклог с бэка (GET /api/notifications, oldest-first) → шина дока при старте.
 * Дедуп по `id` в шине делает повторную гидрацию (реконнект/перезагрузка) безопасной.
 */
export function hydrateServerBacklog(dtos: readonly NotificationDto[]): void {
  for (const dto of dtos) {
    publishServerNotification(dto);
  }
}

/** Событие с бэка (WS `notification` / GET /api/notifications) → шина дока. */
export function publishServerNotification(dto: NotificationDto): void {
  dismissLocalTransportDownIfHostTransport(dto);
  const severity = (dto.severity ?? 'info') as NotificationSeverity;
  const sourceType = (dto.sourceType ?? 'system') as NotificationSourceType;
  const data =
    dto.data && typeof dto.data === 'object' && !Array.isArray(dto.data)
      ? (dto.data as Record<string, unknown>)
      : undefined;
  const input = {
    id: dto.id,
    ts: typeof dto.ts === 'string' ? dto.ts : new Date(dto.ts).toISOString(),
    module: dto.module || 'ohs.connection',
    code: dto.code,
    message: dto.message,
    sourceType,
    // Оси атрибуции материализованы бэком (phase 11.2); при отсутствии шина выведет из sourceType.
    interaction: toInteraction(dto.interaction),
    localization: toLocalization(dto.localization),
    status: toStatus(dto.status),
    correlationId: dto.correlationId ?? undefined,
    data,
  };
  switch (severity) {
    case 'ok':
      notify.ok(notificationBus, input);
      break;
    case 'warning':
      notify.warn(notificationBus, input);
      break;
    case 'error':
      notify.error(notificationBus, input);
      break;
    case 'critical':
      notify.critical(notificationBus, input);
      break;
    default:
      notify.info(notificationBus, input);
  }
}

// ── Host outage (crash-dispatch): локальный фейк + legacy Thread helpers ─────────────────────────
// D5: пока Host лежит — память-only Single (без corr → не Thread; без persist). Durable T/C — Host
// после POST /recovery/outage (D6). Legacy openBackendOutage/resolve* оставлены для тестов/перехода.
const BACKEND_OUTAGE_MODULE = 'ohs.host';
const OUTAGE_CODE_OPEN = 'backend.unavailable';
const OUTAGE_CODE_PROGRESS = 'backend.unavailable.progress';
const OUTAGE_CODE_RECOVERING = 'backend.recovering';
const OUTAGE_CODE_RESOLVED = 'backend.recovered';
/** Тот же code, что у break schedule-end; различает `data.kind` = crash | break. */
const OUTAGE_CODE_INCIDENT_CLOSED = 'connection.incident_closed';
const HEALTHCHECK_CODE_OK = 'backend.healthcheck.ok';
/** Локальный Single на WS drop (memory; без corr). FATAL — пока Host не пришлёт слой C. */
const LOCAL_TRANSPORT_DOWN_CODE = 'host.unreachable';
const LOCAL_TRANSPORT_DOWN_MESSAGE = 'Сервер OHS недоступен';

let localTransportDownId: string | null = null;
let localTransportDownStartMs: number | null = null;

/** corr cold-инцидента простоя (нет предшествующего 500). Экспорт — OhsStore шлёт его в holdRecovery (§9.2). */
export function outageCorrelationId(startMs: number): string {
  return `ohs.backend.outage:${startMs}`;
}

/**
 * WS down → локальная Single FATAL (memory only). Без correlationId → Single, не Thread.
 * Повторный вызов — no-op (держим первый startMs).
 */
export function showLocalTransportDownSingle(startMs: number): void {
  if (localTransportDownId !== null) {
    return;
  }
  localTransportDownId = guidN();
  localTransportDownStartMs = startMs;
  notify.critical(notificationBus, {
    id: localTransportDownId,
    ts: new Date(startMs).toISOString(),
    module: BACKEND_OUTAGE_MODULE,
    code: LOCAL_TRANSPORT_DOWN_CODE,
    message: LOCAL_TRANSPORT_DOWN_MESSAGE,
    sourceType: 'system',
    interaction: 'system',
    localization: 'internal',
    data: { sender: 'client', kind: 'transport', local: true },
  });
}

/** Живой тик длительности на той же Single (upsert по id). */
export function tickLocalTransportDownSingle(nowMs: number): void {
  if (localTransportDownId === null || localTransportDownStartMs === null) {
    return;
  }
  const durationSec = Math.max(1, Math.round((nowMs - localTransportDownStartMs) / 1000));
  notify.critical(notificationBus, {
    id: localTransportDownId,
    ts: new Date(localTransportDownStartMs).toISOString(),
    module: BACKEND_OUTAGE_MODULE,
    code: LOCAL_TRANSPORT_DOWN_CODE,
    message: `${LOCAL_TRANSPORT_DOWN_MESSAGE} · ${formatOutageDuration(durationSec)}`,
    sourceType: 'system',
    interaction: 'system',
    localization: 'internal',
    data: {
      sender: 'client',
      kind: 'transport',
      local: true,
      durationSec,
    },
  });
}

/** Снять локальный фейк (WS up / пришёл durable слой C). */
export function dismissLocalTransportDownSingle(): void {
  if (localTransportDownId === null) {
    return;
  }
  notificationBus.remove(localTransportDownId);
  localTransportDownId = null;
  localTransportDownStartMs = null;
}

/** Есть ли сейчас локальная Single недоступности (для тестов). */
export function hasLocalTransportDownSingle(): boolean {
  return localTransportDownId !== null;
}

/** Local FATAL снимаем, когда Host отдал crash на connection (слой C) — без промежуточного Group T. */
function dismissLocalTransportDownIfHostTransport(dto: NotificationDto): void {
  const corr = dto.correlationId ?? '';
  if (!corr.startsWith('ohs.backend.outage:')) {
    return;
  }
  if (dto.code !== 'backend.unavailable' && dto.code !== 'backend.recovered') {
    return;
  }
  dismissLocalTransportDownSingle();
}

/**
 * `ohs.unhandled` прилетел с чужим corr (обычно requestId/trace), пока бэк ещё не получил hold (§9.2
 * race: swagger/test-exception до holdRecovery) → показываем в стеке инцидента. Persist: вызывающий
 * может пере-POST'ить тот же id с исправленным corr.
 */
export function foldUnhandledIntoOutage(dto: NotificationDto, correlationId: string): void {
  publishServerNotification({ ...dto, correlationId });
}

// Живущие поля инцидента (ключ — corr): id/ts open для mock-POST при resolve (дедуп echo по id).
interface OutageThread {
  correlationId: string;
  startMs: number;
  openId: string;
  openTs: string;
  /** Incident vs Group по горизонту desired на Open (phase 11.11). */
  threadKindHint: 'incident' | 'group';
  /** Connection для journal crash (J8); может отсутствовать без Auto-расписания. */
  connectionId?: number;
}
const outageThreads = new Map<string, OutageThread>();

function mskHms(ms: number): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(ms));
}

/**
 * Guid без дефисов (формат «N», 32 hex) — системное соглашение для id уведомлений: бэк персистит
 * `EventId` как uuid (`Guid.ParseExact(id,"N")`), поэтому НЕ-Guid id роняет аудит-запись. correlationId
 * при этом остаётся свободной строкой (persist как text), группировка/upsert по нему.
 */
function guidN(): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : // Фолбэк без secure-context: 32 hex из Math.random.
        Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return uuid.replace(/-/g, '');
}

function formatOutageDuration(totalSec: number): string {
  if (totalSec < 60) {
    return `${totalSec} с`;
  }
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes} мин ${seconds} с` : `${minutes} мин`;
  }
  const hours = Math.floor(minutes / 60);
  const restMin = minutes % 60;
  return restMin > 0 ? `${hours} ч ${restMin} мин` : `${hours} ч`;
}

/** Фаза 1 (open, fatal): связь с бэком потеряна. Заводит нить инцидента (ts = момент дропа). corr —
 * снаружи (§9.2): cold = outageCorrelationId(startMs); эскалация одиночного 500 = adopt requestId.
 * `threadKindHint`: incident только при desired=true; иначе group (phase 11.11). */
export function openBackendOutage(
  startMs: number,
  correlationId: string,
  threadKindHint: 'incident' | 'group' = 'group',
  connectionId?: number,
): void {
  const startIso = new Date(startMs).toISOString();
  const openId = guidN();
  outageThreads.set(correlationId, {
    correlationId,
    startMs,
    openId,
    openTs: startIso,
    threadKindHint,
    connectionId,
  });
  notify.critical(notificationBus, {
    id: openId,
    ts: startIso,
    module: BACKEND_OUTAGE_MODULE,
    code: OUTAGE_CODE_OPEN,
    message: 'Сервер OHS недоступен, жду восстановления',
    sourceType: 'system',
    interaction: 'system',
    localization: 'internal',
    status: 'active',
    correlationId,
    data: {
      sender: 'client',
      kind: 'crash',
      threadKindHint,
      ...(connectionId != null ? { connectionId } : {}),
    },
  });
}

/** Фаза 2 (progress, error): живой тик длительности простоя. Повторы (underway+тот же code) обновляют
 * строку НА МЕСТЕ (I2 upsert), поэтому каждый тик — свежий id (иначе дедуп по id его отбросит).
 * Тики НЕ персистятся (§9.5) — только живой показ. */
export function tickBackendOutage(startMs: number, nowMs: number, correlationId: string): void {
  const durationSec = Math.max(1, Math.round((nowMs - startMs) / 1000));
  notify.error(notificationBus, {
    id: guidN(),
    ts: new Date(nowMs).toISOString(),
    module: BACKEND_OUTAGE_MODULE,
    code: OUTAGE_CODE_PROGRESS,
    message: `Сервер OHS недоступен · ${formatOutageDuration(durationSec)}`,
    sourceType: 'system',
    interaction: 'system',
    localization: 'internal',
    status: 'underway',
    correlationId,
    data: { since: new Date(startMs).toISOString(), durationSec, sender: 'client' },
  });
}

/**
 * Фаза recovering: бэк снова на связи, система ещё поднимается. Каждый вход — **новая** строка
 * (§9.2: перед OK всегда warn; пачка 500 → один warn после кулдауна). `sender=client`; `since` нет.
 * Локальная шина сразу; persist — только в пакете close (`resolveBackendOutage`), иначе при обрыве
 * settle в БД остаётся сирота `backend.recovering` без FATAL/OK.
 */
export function warnBackendOutage(correlationId: string): NotificationDto {
  const warnId = guidN();
  const ts = new Date().toISOString();
  const message = 'Сервер OHS доступен, идёт восстановление системы…';
  const data = { sender: 'client' };
  notify.warn(notificationBus, {
    id: warnId,
    ts,
    module: BACKEND_OUTAGE_MODULE,
    code: OUTAGE_CODE_RECOVERING,
    message,
    sourceType: 'system',
    interaction: 'system',
    localization: 'internal',
    status: 'underway',
    correlationId,
    data,
  });
  return {
    id: warnId,
    ts,
    severity: 'warning',
    sourceType: 'system',
    module: BACKEND_OUTAGE_MODULE,
    code: OUTAGE_CODE_RECOVERING,
    message,
    status: 'underway',
    correlationId,
    data,
    interaction: 'system',
    localization: 'internal',
  };
}

/**
 * Одиночный 500 (§9.3): бэк ответил на health-probe (жив) → закрываем micro-инцидент «проверкой ОК» под
 * ТЕМ ЖЕ corr, что у 500 (requestId). Возвращает DTO для персиста — 500 персистит бэк, ok персистим mock-POST.
 */
export function healthCheckOk(correlationId: string): NotificationDto {
  const id = guidN();
  const ts = new Date().toISOString();
  const message = 'Проверка работоспособности: сервер OHS функционирует штатно';
  const data = { sender: 'client', probe: 'health_ok' };
  notify.ok(notificationBus, {
    id,
    ts,
    module: BACKEND_OUTAGE_MODULE,
    code: HEALTHCHECK_CODE_OK,
    message,
    sourceType: 'system',
    interaction: 'system',
    localization: 'internal',
    status: 'resolved',
    correlationId,
    data,
  });
  return {
    id,
    ts,
    severity: 'ok',
    sourceType: 'system',
    module: BACKEND_OUTAGE_MODULE,
    code: HEALTHCHECK_CODE_OK,
    message,
    status: 'resolved',
    correlationId,
    data,
    interaction: 'system',
    localization: 'internal',
  };
}

/**
 * I12 / §9.3: недавние orphan `ohs.unhandled` (critical) без terminal `resolved` на corr.
 * Пачка parallel 500 → N разных requestId; health-ok должен закрыть все, не один.
 */
export function collectRecentOrphanUnhandledCorrs(opts: {
  withinMs: number;
  nowMs?: number;
}): string[] {
  const nowMs = opts.nowMs ?? Date.now();
  const seen = new Set<string>();
  const result: string[] = [];
  for (const e of notificationBus.events) {
    if (e.code !== 'ohs.unhandled' || (e.severity ?? '') !== 'critical') {
      continue;
    }
    const corr = e.correlationId;
    if (!corr || seen.has(corr)) {
      continue;
    }
    seen.add(corr);
    const ts = Date.parse(e.ts);
    if (!Number.isFinite(ts) || nowMs - ts > opts.withinMs) {
      continue;
    }
    if (notificationBus.statusOf(corr) === 'resolved') {
      continue;
    }
    result.push(corr);
  }
  return result;
}

/**
 * I12: health-probe ok → закрыть все недавние orphan FATAL (локальная шина + DTO для mock-POST).
 */
export function closeRecentOrphanUnhandledWithHealthOk(opts: {
  withinMs: number;
  nowMs?: number;
}): NotificationDto[] {
  return collectRecentOrphanUnhandledCorrs(opts).map((corr) => healthCheckOk(corr));
}

/**
 * Single INFO после backend.recovered: Auto×N стоп при open break (не в link-corr).
 * Локальная шина + DTO для mock-POST.
 */
export function publishOperatorActionNeeded(row: ConnectionNeedsOperatorDto): NotificationDto {
  const id = guidN();
  const ts = new Date().toISOString();
  const attempts = row.attempts > 0 ? row.attempts : 5;
  const message =
    `${row.label}: Auto был остановлен после ${attempts} попыток — требуется подключение оператором`;
  const data = {
    connectionId: row.connectionId,
    attempts,
    reason: row.reason,
    sender: 'client',
  };
  notify.info(notificationBus, {
    id,
    ts,
    module: 'ohs.connection',
    code: 'connection.operator_action_needed',
    message,
    sourceType: 'system',
    interaction: 'system',
    localization: 'internal',
    data,
  });
  return {
    id,
    ts,
    severity: 'info',
    sourceType: 'system',
    module: 'ohs.connection',
    code: 'connection.operator_action_needed',
    message,
    data,
    interaction: 'system',
    localization: 'internal',
  };
}

/**
 * Фаза 4 (resolve, ok): система восстановлена. Эмитит локальный ok и возвращает DTO для mock-POST:
 * open (+ опц. последний recovering) + resolve. Persist warn только здесь — не на входе в warning.
 */
export function resolveBackendOutage(
  startMs: number,
  endMs: number,
  correlationId: string,
  recoveringDto?: NotificationDto | null,
): NotificationDto[] {
  const thread = outageThreads.get(correlationId) ?? {
    correlationId,
    startMs,
    openId: guidN(),
    openTs: new Date(startMs).toISOString(),
    threadKindHint: 'group' as const,
  };
  outageThreads.delete(correlationId);

  const durationSec = Math.max(1, Math.round((endMs - startMs) / 1000));
  const endIso = new Date(endMs).toISOString();
  const resolveId = guidN();
  const okMessage = 'Система восстановлена, сервер OHS функционирует штатно';
  const spanLine = `Недоступен ${mskHms(startMs)} → ${mskHms(endMs)} (МСК) · ${formatOutageDuration(durationSec)}`;
  // `result` — итог интервала (не `message`: то заголовок события). Без `lines` → expanded = JSON.
  const resolveData = {
    result: spanLine,
    sender: 'client',
    closeOutcome: 'recovered' as const,
    ...(thread.connectionId != null ? { connectionId: thread.connectionId } : {}),
  };

  notify.ok(notificationBus, {
    id: resolveId,
    ts: endIso,
    module: BACKEND_OUTAGE_MODULE,
    code: OUTAGE_CODE_RESOLVED,
    message: okMessage,
    sourceType: 'system',
    interaction: 'system',
    localization: 'internal',
    status: 'resolved',
    correlationId: thread.correlationId,
    data: resolveData,
  });

  const openData = {
    sender: 'client' as const,
    kind: 'crash' as const,
    threadKindHint: thread.threadKindHint,
    ...(thread.connectionId != null ? { connectionId: thread.connectionId } : {}),
  };
  const openDto: NotificationDto = {
    id: thread.openId,
    ts: thread.openTs,
    severity: 'critical',
    sourceType: 'system',
    module: BACKEND_OUTAGE_MODULE,
    code: OUTAGE_CODE_OPEN,
    message: 'Сервер OHS недоступен, жду восстановления',
    status: 'active',
    correlationId: thread.correlationId,
    data: openData,
    interaction: 'system',
    localization: 'internal',
  };
  const resolveDto: NotificationDto = {
    id: resolveId,
    ts: endIso,
    severity: 'ok',
    sourceType: 'system',
    module: BACKEND_OUTAGE_MODULE,
    code: OUTAGE_CODE_RESOLVED,
    message: okMessage,
    status: 'resolved',
    correlationId: thread.correlationId,
    data: resolveData,
    interaction: 'system',
    localization: 'internal',
  };
  return recoveringDto
    ? [openDto, recoveringDto, resolveDto]
    : [openDto, resolveDto];
}

/** Строка разрыва как на бэке (FormatGapLine): «Разрыв … (МСК), длительность HH:MM:SS». */
function formatGapLineMsk(startMs: number, endMs: number): string {
  const msk = (ms: number) => {
    const d = new Date(ms + 3 * 60 * 60_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      day: `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}`,
      hms: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
      y: d.getUTCFullYear(),
      m: d.getUTCMonth(),
      dd: d.getUTCDate(),
    };
  };
  const a = msk(startMs);
  const b = msk(endMs);
  const durSec = Math.max(0, Math.round((endMs - startMs) / 1000));
  const hh = String(Math.floor(durSec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((durSec % 3600) / 60)).padStart(2, '0');
  const ss = String(durSec % 60).padStart(2, '0');
  const sameDay = a.y === b.y && a.m === b.m && a.dd === b.dd;
  const fromText = sameDay ? a.hms : `${a.day} ${a.hms}`;
  const toText = sameDay ? b.hms : `${b.day} ${b.hms}`;
  return `Разрыв ${fromText} → ${toText} (МСК), длительность ${hh}:${mm}:${ss}`;
}

/**
 * Исход `abandoned_schedule` для crash: WARNING resolved (без green / без `backend.recovered`).
 * Эмитит close в локальную шину; возвращает [open, close] для mock-POST когда бэк оживёт
 * (как resolveBackendOutage, но close = incident_closed · kind=crash).
 */
export function abandonBackendOutageBySchedule(
  startMs: number,
  endMs: number,
  correlationId: string,
  connectionId: number,
  connectionLabel: string,
): NotificationDto[] {
  const thread = outageThreads.get(correlationId) ?? {
    correlationId,
    startMs,
    openId: guidN(),
    openTs: new Date(startMs).toISOString(),
    threadKindHint: 'group' as const,
  };
  outageThreads.delete(correlationId);

  const endIso = new Date(endMs).toISOString();
  const closeId = guidN();
  const message = `${connectionLabel}: инцидент закрыт по окончании окна расписания`;
  const closeData = {
    connectionId,
    kind: 'crash' as const,
    reason: 'schedule_end',
    sender: 'client',
    result: `Закрыто по окончании окна расписания; ${formatGapLineMsk(startMs, endMs)}`,
    closeOutcome: 'abandoned_schedule' as const,
  };

  notify.warn(notificationBus, {
    id: closeId,
    ts: endIso,
    module: BACKEND_OUTAGE_MODULE,
    code: OUTAGE_CODE_INCIDENT_CLOSED,
    message,
    sourceType: 'system',
    interaction: 'system',
    localization: 'internal',
    status: 'resolved',
    correlationId: thread.correlationId,
    data: closeData,
  });

  const openDto: NotificationDto = {
    id: thread.openId,
    ts: thread.openTs,
    severity: 'critical',
    sourceType: 'system',
    module: BACKEND_OUTAGE_MODULE,
    code: OUTAGE_CODE_OPEN,
    message: 'Сервер OHS недоступен, жду восстановления',
    status: 'active',
    correlationId: thread.correlationId,
    data: {
      sender: 'client',
      kind: 'crash',
      threadKindHint: thread.threadKindHint,
      connectionId,
    },
    interaction: 'system',
    localization: 'internal',
  };
  const closeDto: NotificationDto = {
    id: closeId,
    ts: endIso,
    severity: 'warning',
    sourceType: 'system',
    module: BACKEND_OUTAGE_MODULE,
    code: OUTAGE_CODE_INCIDENT_CLOSED,
    message,
    status: 'resolved',
    correlationId: thread.correlationId,
    data: closeData,
    interaction: 'system',
    localization: 'internal',
  };
  return [openDto, closeDto];
}
