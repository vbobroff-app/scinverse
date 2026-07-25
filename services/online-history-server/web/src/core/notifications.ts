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
import type { NotificationDto } from './types';

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

export const notificationBus = createNotificationBus();

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

// ── Недоступность бэка (7j.20): mock-behaviour optimistic pattern, ИНЦИДЕНТ ───────────────────────
// Бэк не может сообщить о СОБСТВЕННОМ простое, пока лежит → детектит клиент (дроп WS) и ведёт инцидент
// сам (в отличие от инцидентов связи, где оркестратор — NotificationHub на бэке; тут бэк мёртв). Стек:
//   fatal  (open)     — «Сервер OHS недоступен, жду восстановления»            (status active)
//   error  (progress) — «Сервер OHS недоступен · N с», живые тики 5 c          (status underway, upsert)
//   warning           — «Сервер OHS доступен, идёт восстановление системы…»    (status underway)
//   ok     (resolve)  — «Система восстановлена, сервер OHS функционирует штатно» (status resolved)
// Граница инцидента — только доступность client↔backend; здоровье линка к бирже — отдельная нить.
// Персист (по реконнекте, mock-POST задним числом): open + resolve; длительность — в expanded у resolve.
// progress/warning эфемерны (POST невозможен, пока бэк лежит). Точность начала — по часам клиента
// (± цикл WS-retry ~2 c); более точный источник (link_liveness.to_ts осиротевшего интервала) — будущий
// backend-side путь. Мульти-вкладка → дубли инцидентов от разных клиентов (боль дедупа, §8).
const BACKEND_OUTAGE_MODULE = 'ohs.host';
const OUTAGE_CODE_OPEN = 'backend.unavailable';
const OUTAGE_CODE_PROGRESS = 'backend.unavailable.progress';
const OUTAGE_CODE_RECOVERING = 'backend.recovering';
const OUTAGE_CODE_RESOLVED = 'backend.recovered';

function outageCorrelationId(startMs: number): string {
  return `ohs.backend.outage:${startMs}`;
}

/**
 * Настоящий `ohs.unhandled` (FATAL/critical) во время активного инцидента простоя → втягиваем в СТЕК
 * инцидента (nc-availability.md §6.1): публикуем под corr инцидента, оставляя `critical` (уровень = «FATAL:»,
 * отдельного типа нет) и исходный id (persist/echo). Так 500 живого-но-нестабильного бэка видны как часть
 * той же нити (кликом по corr — весь стек), а не сиротой-FATAL. Голова группы — по новейшему событию,
 * поэтому этот critical в середине не мешает зелёному закрытию (resolved эмитится последним). Персист
 * остаётся под серверным corr → после reload вернётся отдельной строкой (фолд пока для живого показа, §8).
 */
export function foldUnhandledIntoOutage(dto: NotificationDto, startMs: number): void {
  publishServerNotification({ ...dto, correlationId: outageCorrelationId(startMs) });
}

// Живущие поля инцидента (ключ — startMs): open эмитится по grace, resolve — по settle; между ними
// нужно помнить id/ts open, чтобы переиспользовать их в mock-POST (дедуп echo по id).
interface OutageThread {
  correlationId: string;
  openId: string;
  openTs: string;
}
const outageThreads = new Map<number, OutageThread>();

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

/** Фаза 1 (open, fatal): связь с бэком потеряна. Заводит нить инцидента (ts = момент дропа). */
export function openBackendOutage(startMs: number): void {
  const startIso = new Date(startMs).toISOString();
  const correlationId = outageCorrelationId(startMs);
  const openId = guidN();
  outageThreads.set(startMs, { correlationId, openId, openTs: startIso });
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
    data: { since: startIso, backdated: true },
  });
}

/** Фаза 2 (progress, error): живой тик длительности простоя. Повторы (underway+тот же code) обновляют
 * строку НА МЕСТЕ (I2 upsert), поэтому каждый тик — свежий id (иначе дедуп по id его отбросит). */
export function tickBackendOutage(startMs: number, nowMs: number): void {
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
    correlationId: outageCorrelationId(startMs),
    data: { since: new Date(startMs).toISOString(), durationSec },
  });
}

/** Фаза 3 (warning): бэк снова на связи, но система ещё поднимается (гидрация/ре-хендшейк/писатели). */
export function warnBackendOutage(startMs: number): void {
  notify.warn(notificationBus, {
    id: guidN(),
    ts: new Date().toISOString(),
    module: BACKEND_OUTAGE_MODULE,
    code: OUTAGE_CODE_RECOVERING,
    message: 'Сервер OHS доступен, идёт восстановление системы…',
    sourceType: 'system',
    interaction: 'system',
    localization: 'internal',
    status: 'underway',
    correlationId: outageCorrelationId(startMs),
    data: { since: new Date(startMs).toISOString() },
  });
}

/**
 * Фаза 4 (resolve, ok): система восстановлена. Эмитит локальный ok и возвращает DTO'шки для mock-POST
 * задним числом — open (переиспользуя id/ts из нити → echo дедупится, персист под тем же id) и resolve
 * (ts = момент восстановления, длительность в expanded). Нить закрывается (удаляется из карты).
 */
export function resolveBackendOutage(startMs: number, endMs: number): NotificationDto[] {
  const thread = outageThreads.get(startMs) ?? {
    correlationId: outageCorrelationId(startMs),
    openId: guidN(),
    openTs: new Date(startMs).toISOString(),
  };
  outageThreads.delete(startMs);

  const durationSec = Math.max(1, Math.round((endMs - startMs) / 1000));
  const endIso = new Date(endMs).toISOString();
  const resolveId = guidN();
  const okMessage = 'Система восстановлена, сервер OHS функционирует штатно';
  const spanLine = `Недоступен ${mskHms(startMs)} → ${mskHms(endMs)} (МСК) · ${formatOutageDuration(durationSec)}`;
  const resolveData = { since: thread.openTs, until: endIso, durationSec, backdated: true, lines: [spanLine] };

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
    data: { since: thread.openTs, backdated: true },
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
  return [openDto, resolveDto];
}
