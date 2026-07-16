/**
 * Хост phase 11: singleton-шина уведомлений + состояние дока.
 * Пакет `@scinverse/notification-center` не знает про OHS — адаптеры и seed живут здесь.
 */

import { createNotificationBus, notify } from '@scinverse/notification-center';
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
    interaction: 'resolving',
    localization: 'internal',
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
    interaction: 'resolving',
    localization: 'internal',
  });
}

seedDemoNotifications();
