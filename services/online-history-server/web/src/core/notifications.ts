/**
 * Хост phase 11: singleton-шина уведомлений + состояние дока.
 * Пакет `@scinverse/notification-center` не знает про OHS — адаптеры и seed живут здесь.
 */

import { BehaviorSubject } from 'rxjs';
import { createNotificationBus, notify } from '@scinverse/notification-center';

export const notificationBus = createNotificationBus();

/** Открыт ли док в колонке workspace (колокольчик в рейле). */
export const notificationDockOpen$ = new BehaviorSubject(false);

export function setNotificationDockOpen(open: boolean): void {
  notificationDockOpen$.next(open);
}

export function toggleNotificationDock(): void {
  notificationDockOpen$.next(!notificationDockOpen$.value);
}

/** Тестовое событие для проверки интеграции (один раз при загрузке модуля). */
notify.info(notificationBus, {
  id: 'ohs.notification-center.hello',
  module: 'ohs.ui',
  code: 'notification-center.hello',
  message: "Hello! I'm notification center)",
  sourceType: 'system',
});
