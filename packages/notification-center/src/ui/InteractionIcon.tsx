import type { ReactNode } from 'react';
import type { NotificationEvent } from '../types';
import { resolveInteraction, resolveLocalization } from '../types';
import { Tip } from './Tooltip';
import styles from './InteractionIcon.module.css';

interface Props {
  event: NotificationEvent;
}

/** Базовая линейная иконка 16×16, монохром (currentColor). */
function StrokeIcon({ children, label }: { children: ReactNode; label: string }) {
  return (
    <Tip content={label}>
      <span className={styles.wrap} aria-label={label}>
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
    </Tip>
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

/**
 * Монохромная иконка взаимодействия:
 * user → человек; system+internal → провайдеры; system+external → внешний контур.
 */
export function InteractionIcon({ event }: Props) {
  const interaction = resolveInteraction(event);
  const localization = resolveLocalization(event);

  if (interaction === 'user') {
    return (
      <StrokeIcon label="Пользовательские">
        <UserGlyph />
      </StrokeIcon>
    );
  }

  if (localization === 'external') {
    return (
      <StrokeIcon label="Системный · внешние">
        <SystemExternalGlyph />
      </StrokeIcon>
    );
  }

  return (
    <StrokeIcon label="Системный · внутренние">
      <SystemInternalGlyph />
    </StrokeIcon>
  );
}
