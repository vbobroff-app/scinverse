/** Общие монохромные SVG-иконки (наследуют currentColor). */

import type { ReactNode } from 'react';

export interface IconProps {
  className?: string;
}

/** Базовая обёртка для линейных (feather-стиль) иконок 24×24. */
function StrokeIcon({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      width="1em"
      height="1em"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Календарь (filled, Phosphor-стиль) — для «Диапазон» и торговых календарей. */
export function CalendarIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 256 256"
      fill="currentColor"
      width="1em"
      height="1em"
      aria-hidden="true"
    >
      <path d="M208 32h-24v-8a8 8 0 0 0-16 0v8H88v-8a8 8 0 0 0-16 0v8H48a16 16 0 0 0-16 16v160a16 16 0 0 0 16 16h160a16 16 0 0 0 16-16V48a16 16 0 0 0-16-16M72 48v8a8 8 0 0 0 16 0v-8h80v8a8 8 0 0 0 16 0v-8h24v32H48V48Zm136 160H48V96h160zm-96-88v64a8 8 0 0 1-16 0v-51.06l-4.42 2.22a8 8 0 0 1-7.16-14.32l16-8A8 8 0 0 1 112 120m59.16 30.45L152 176h16a8 8 0 0 1 0 16h-32a8 8 0 0 1-6.4-12.8l28.78-38.37a8 8 0 1 0-13.31-8.83a8 8 0 1 1-13.85-8A24 24 0 0 1 176 136a23.76 23.76 0 0 1-4.84 14.45" />
    </svg>
  );
}

/** Прицел (crosshair) — тумблер вертикального time-line. */
export function CrosshairIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      width="1em"
      height="1em"
      aria-hidden="true"
    >
      <path d="M12 16v5m0-18v5m4 4h5M3 12h5" />
    </svg>
  );
}

/** Прямоугольник — тумблер подсветки дней (рамка-контейнер вокруг каждого дня). */
export function DayBoxIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Часы (feather-стиль) — для сессии биржи в тайм-лайн-фильтре. */
export function ClockIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      width="1em"
      height="1em"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  );
}

/* ───────────────── Иконки левого рейла (навигация верхнего уровня) ───────────────── */

/** Биржи — здание с колоннами (банк/биржа). */
export function ExchangeIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M3 9.5 12 4l9 5.5" />
      <path d="M4 9.5h16" />
      <path d="M6 9.5v8M10 9.5v8M14 9.5v8M18 9.5v8" />
      <path d="M3.5 20.5h17" />
    </StrokeIcon>
  );
}

/** Провайдеры — стек серверов/источников данных (подключения). */
export function ProvidersIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <rect x="3.5" y="4" width="17" height="7" rx="1.5" />
      <rect x="3.5" y="13" width="17" height="7" rx="1.5" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </StrokeIcon>
  );
}

/** Интеграции — вилка/разъём (внешний API-сервис). */
export function IntegrationsIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M9 3v5M15 3v5" />
      <path d="M6 8h12v3a6 6 0 0 1-12 0z" />
      <path d="M12 17v4" />
    </StrokeIcon>
  );
}

/** Новости — газета/лента событий. */
export function NewsIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M4 5.5h13a1 1 0 0 1 1 1v11a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z" />
      <path d="M18 8.5h1.5a.5.5 0 0 1 .5.5v8.5a2 2 0 0 1-2 2" />
      <path d="M7 9h7M7 12.5h7M7 16h4" />
    </StrokeIcon>
  );
}

/** Сообщения — конверт. */
export function MessagesIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="m4 7 8 5.5L20 7" />
    </StrokeIcon>
  );
}

/** Помощь — знак вопроса в круге. */
export function HelpIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9.3a2.8 2.8 0 0 1 5.4 1c0 1.9-2.6 2.2-2.6 3.7" />
      <path d="M12 17.3h.01" />
    </StrokeIcon>
  );
}

/** Центр уведомлений — колокольчик. */
export function BellIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M18 8.5a6 6 0 0 0-12 0c0 6.5-2.5 8.5-2.5 8.5h17S18 15 18 8.5" />
      <path d="M13.7 20.5a2 2 0 0 1-3.4 0" />
    </StrokeIcon>
  );
}

/** Пользователь — аватар. */
export function UserIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M19 20.5v-1.8a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v1.8" />
      <circle cx="12" cy="7.5" r="3.8" />
    </StrokeIcon>
  );
}
