/**
 * Навигация верхнего уровня (левый вертикальный рейл, стиль Финам).
 *
 * Фреймворк-независимый слой: тут только идентификаторы секций и их метаданные (без иконок/React).
 * Иконки и React-контент подключаются в ui-слое (`ui/navigation.tsx`), чтобы `core` оставался чистым.
 *
 * Расширение функционала = добавить `NavSectionId` + запись в `NAV_SECTIONS` (+ иконку/страницу в ui).
 */

export type NavSectionId =
  | 'exchanges'
  | 'providers'
  | 'integrations'
  | 'news'
  | 'messages'
  | 'help'
  | 'notifications'
  | 'user';

/** Группа в рейле: основные разделы сверху, служебные (help/уведомления/пользователь) снизу. */
export type NavGroup = 'top' | 'bottom';

export interface NavSection {
  id: NavSectionId;
  /** Подпись (tooltip / aria-label). */
  label: string;
  group: NavGroup;
  /** Готов ли раздел (false → заглушка-задел под будущую фазу). */
  ready: boolean;
}

/**
 * Реестр разделов — единый источник правды для рейла и переключения рабочей области.
 * Порядок в массиве = порядок кнопок в соответствующей группе.
 */
export const NAV_SECTIONS: readonly NavSection[] = [
  { id: 'exchanges', label: 'Биржи', group: 'top', ready: false },
  { id: 'providers', label: 'Провайдеры', group: 'top', ready: true },
  { id: 'integrations', label: 'Интеграции', group: 'top', ready: true },
  { id: 'news', label: 'Новости', group: 'top', ready: false },
  { id: 'messages', label: 'Сообщения', group: 'top', ready: false },
  { id: 'help', label: 'Помощь', group: 'bottom', ready: false },
  { id: 'notifications', label: 'Центр уведомлений', group: 'bottom', ready: true },
  { id: 'user', label: 'Пользователь', group: 'bottom', ready: false },
];

/** Раздел по умолчанию при старте. */
export const DEFAULT_SECTION: NavSectionId = 'providers';

export function navSectionsByGroup(group: NavGroup): readonly NavSection[] {
  return NAV_SECTIONS.filter((s) => s.group === group);
}

export function navSection(id: NavSectionId): NavSection {
  const found = NAV_SECTIONS.find((s) => s.id === id);
  if (!found) {
    throw new Error(`Unknown nav section: ${id}`);
  }
  return found;
}
