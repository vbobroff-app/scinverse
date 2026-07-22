/**
 * Хост phase 11: singleton-шина уведомлений + состояние дока.
 * Пакет `@scinverse/notification-center` не знает про OHS — адаптеры и seed живут здесь.
 */

import { createNotificationBus, notify } from '@scinverse/notification-center';
import type {
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
