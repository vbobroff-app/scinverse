import type { ReactNode } from 'react';
import type { NotificationEvent } from '../types';
import { resolveInteraction, resolveLocalization } from '../types';
import styles from './InteractionIcon.module.css';

interface Props {
  event: NotificationEvent;
}

/** Базовая линейная иконка 16×16, монохром (currentColor). */
function StrokeIcon({ children, title }: { children: ReactNode; title: string }) {
  return (
    <span className={styles.wrap} title={title} aria-label={title}>
      <svg
        className={styles.icon}
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
    </span>
  );
}

/** Пользователь — силуэт. */
function UserGlyph() {
  return (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5.5 19.5c1.2-3.2 3.5-4.8 6.5-4.8s5.3 1.6 6.5 4.8" />
    </>
  );
}

/** Система / внутренняя — как ProvidersIcon в OHS sidebar (стек серверов). */
function SystemInternalGlyph() {
  return (
    <>
      <rect x="3.5" y="4" width="17" height="7" rx="1.5" />
      <rect x="3.5" y="13" width="17" height="7" rx="1.5" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </>
  );
}

/** Система / внешняя — разъём/вилка (как Integrations). */
function SystemExternalGlyph() {
  return (
    <>
      <path d="M9 3v5M15 3v5" />
      <path d="M6 8h12v3a6 6 0 0 1-12 0z" />
      <path d="M12 17v4" />
    </>
  );
}

/** Резолвинг — цикл/обход. */
function ResolvingGlyph() {
  return (
    <>
      <path d="M4 12a8 8 0 0 1 13.5-5.8L20 8" />
      <path d="M20 4v4h-4" />
      <path d="M20 12a8 8 0 0 1-13.5 5.8L4 16" />
      <path d="M4 20v-4h4" />
    </>
  );
}

/**
 * Монохромная иконка взаимодействия:
 * user → человек; system+internal → провайдеры; system+external → внешний контур; resolving → цикл.
 */
export function InteractionIcon({ event }: Props) {
  const interaction = resolveInteraction(event);
  const localization = resolveLocalization(event);

  if (interaction === 'user') {
    return (
      <StrokeIcon title="Пользовательские">
        <UserGlyph />
      </StrokeIcon>
    );
  }

  if (interaction === 'resolving') {
    return (
      <StrokeIcon title="Резолвинг">
        <ResolvingGlyph />
      </StrokeIcon>
    );
  }

  if (localization === 'external') {
    return (
      <StrokeIcon title="Системный · внешние">
        <SystemExternalGlyph />
      </StrokeIcon>
    );
  }

  return (
    <StrokeIcon title="Системный · внутренние">
      <SystemInternalGlyph />
    </StrokeIcon>
  );
}
