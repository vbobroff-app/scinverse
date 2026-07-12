/**
 * UI-привязка навигации: сопоставляет разделы (`core/navigation`) с иконками рейла.
 * Держим отдельно от `core`, чтобы фреймворк-независимый слой не тянул React/иконки.
 */

import type { ComponentType } from 'react';
import type { NavSectionId } from '../core/navigation';
import {
  BellIcon,
  ExchangeIcon,
  HelpIcon,
  type IconProps,
  MessagesIcon,
  NewsIcon,
  ProvidersIcon,
  UserIcon,
} from './components/icons';

export const NAV_ICONS: Record<NavSectionId, ComponentType<IconProps>> = {
  exchanges: ExchangeIcon,
  providers: ProvidersIcon,
  news: NewsIcon,
  messages: MessagesIcon,
  help: HelpIcon,
  notifications: BellIcon,
  user: UserIcon,
};
