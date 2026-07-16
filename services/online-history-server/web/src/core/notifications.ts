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

/** Тестовое событие для проверки интеграции (один раз при загрузке модуля). */
notify.info(notificationBus, {
  id: 'ohs.notification-center.hello',
  module: 'ohs.ui',
  code: 'notification-center.hello',
  message: "Hello! I'm notification center)",
  sourceType: 'system',
});
