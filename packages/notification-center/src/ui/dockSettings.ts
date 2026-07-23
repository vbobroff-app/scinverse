/** Настройки отображения / поведения центра уведомлений. */
export interface NotificationDockSettings {
  /** Панель фильтров. */
  showFilters: boolean;
  /** Учёт непрочитанных (бейджи, рамки, счётчик на колокольчике). */
  trackUnread: boolean;
  /** Иконка severity в строке (логотип). Независима от {@link showType}. */
  showStatusLogo: boolean;
  /** Текстовая метка типа (Info:/Warning:/ERROR:/…) за иконкой. Независима от {@link showStatusLogo}. */
  showType: boolean;
  /** Дублировать новые уведомления в системный трей / Notification API. */
  sendToTray: boolean;
}

export const EMPTY_DOCK_SETTINGS: NotificationDockSettings = {
  showFilters: true,
  trackUnread: true,
  showStatusLogo: true,
  showType: true,
  sendToTray: false,
};

export function normalizeDockSettings(
  value: Partial<NotificationDockSettings> | null | undefined,
): NotificationDockSettings {
  return {
    showFilters: value?.showFilters !== false,
    trackUnread: value?.trackUnread !== false,
    showStatusLogo: value?.showStatusLogo !== false,
    showType: value?.showType !== false,
    sendToTray: value?.sendToTray === true,
  };
}
