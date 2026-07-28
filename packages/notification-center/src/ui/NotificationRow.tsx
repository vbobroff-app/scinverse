import { useEffect, useRef, useState } from 'react';
import type { NotificationEvent, NotificationSeverity } from '../types';
import { resolveStatus } from '../types';
import type { FormatTs } from '../format/formatTs';
import { InteractionIcon } from './InteractionIcon';
import { SeverityIcon } from './SeverityIcon';
import { Tip } from './Tooltip';
import styles from './NotificationRow.module.css';

interface Props {
  event: NotificationEvent;
  formatTs: FormatTs;
  unread?: boolean;
  /** Показывать иконку severity (логотип). Независимо от {@link showType}. */
  showStatusLogo?: boolean;
  /** Показывать текстовую метку типа (Info:/ERROR:/…) за иконкой. Независимо от {@link showStatusLogo}. */
  showType?: boolean;
  /**
   * Subtle `[!]` / `[G]` внутри Thread: сдвигает контент, не indent карточки
   * (to-threads §2.2 / §4.1).
   */
  kindBadge?: 'incident' | 'group';
  isFavorite?: boolean;
  isLeft?: boolean;
  onToggleFavorite?: () => void;
  onToggleLeft?: () => void;
  onOpen?: (event: NotificationEvent) => void;
  /** Клик по Id инцидента (`correlationId`) — подставляет corr в поиск, не сбрасывая остальные фильтры. */
  onFilterIncident?: (correlationId: string) => void;
}

const SEVERITY_LABEL: Record<NotificationSeverity, string> = {
  ok: 'OK:',
  info: 'INFO:',
  warning: 'WARN:',
  error: 'ERROR:',
  critical: 'FATAL:',
};

/**
 * Фон-маска только по типу (severity), не по lifecycle-status:
 * info → голубая; warning → жёлтая; error/critical → красная; ok → зелёная.
 */
function backgroundClass(event: NotificationEvent): string {
  switch (event.severity) {
    case 'info':
      return styles.bgInfo;
    case 'warning':
      return styles.bgWarning;
    case 'error':
    case 'critical':
      return styles.bgAlert;
    case 'ok':
      return styles.bgOk;
    default:
      return '';
  }
}

function detailText(event: NotificationEvent): string | null {
  if (!event.data || Object.keys(event.data).length === 0) {
    return null;
  }
  const lines = event.data.lines;
  if (Array.isArray(lines) && lines.length > 0 && lines.every((x) => typeof x === 'string')) {
    return (lines as string[]).join('\n');
  }
  if (typeof event.data.detail === 'string' && event.data.detail.trim()) {
    return event.data.detail;
  }
  try {
    return JSON.stringify(event.data, null, 2);
  } catch {
    return String(event.data);
  }
}

export function NotificationRow({
  event,
  formatTs,
  unread,
  showStatusLogo = true,
  showType = true,
  kindBadge,
  isFavorite,
  isLeft,
  onToggleFavorite,
  onToggleLeft,
  onOpen,
  onFilterIncident,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const detail = detailText(event);
  const status = resolveStatus(event);
  const bgClass = backgroundClass(event);

  useEffect(() => {
    if (expanded && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [expanded]);

  const toggle = () => {
    setExpanded((v) => !v);
    onOpen?.(event);
  };

  const copy = async () => {
    const text = detail ? `${event.message}\n${detail}` : event.message;
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      ref={ref}
      className={[styles.row, unread ? styles.unread : '', styles[event.severity], bgClass]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={styles.main}>
        <button
          type="button"
          className={styles.expandBtn}
          onClick={toggle}
          aria-expanded={expanded}
          aria-label={expanded ? 'Свернуть' : 'Подробности'}
        >
          <span className={[styles.chevron, expanded ? styles.chevronOpen : ''].filter(Boolean).join(' ')}>
            ▴
          </span>
        </button>
        {kindBadge && (
          <span
            className={[
              styles.kindBadge,
              kindBadge === 'incident' ? styles.kindIncident : styles.kindGroup,
            ].join(' ')}
            aria-hidden
          >
            {kindBadge === 'incident' ? '[!]' : '[G]'}
          </span>
        )}
        {showStatusLogo && <SeverityIcon severity={event.severity} />}
        {showType && (
          <span className={styles.severityLabel} aria-label={event.severity}>
            {SEVERITY_LABEL[event.severity]}
          </span>
        )}
        <time className={styles.time} dateTime={event.ts}>
          {formatTs(event.ts)}
        </time>
        <InteractionIcon event={event} />
        <span className={[styles.message, expanded ? styles.messageWrap : ''].filter(Boolean).join(' ')}>
          {event.message}
        </span>
        {(onToggleFavorite || onToggleLeft) && (
          <span className={styles.marks}>
            {onToggleFavorite && (
              <Tip content={isFavorite ? 'Снять' : 'Отметить'}>
                <button
                  type="button"
                  className={[styles.markBtn, isFavorite ? styles.markOn : ''].filter(Boolean).join(' ')}
                  aria-pressed={Boolean(isFavorite)}
                  aria-label="Избранное"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite();
                  }}
                >
                  ★
                </button>
              </Tip>
            )}
            {onToggleLeft && (
              <Tip content={isLeft ? 'Показывать' : 'В спам'}>
                <button
                  type="button"
                  className={[styles.markBtn, isLeft ? styles.markOnSpam : ''].filter(Boolean).join(' ')}
                  aria-pressed={Boolean(isLeft)}
                  aria-label="Спам"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleLeft();
                  }}
                >
                  ⊘
                </button>
              </Tip>
            )}
          </span>
        )}
        <Tip content="Копировать">
          <button type="button" className={styles.copyBtn} onClick={copy} aria-label="Копировать">
            ⎘
          </button>
        </Tip>
      </div>
      {expanded && (
        <div className={styles.detail}>
          <div className={styles.meta}>
            <span>code: {event.code}</span>
            <span>status: {status}</span>
            {typeof event.data?.sender === 'string' && <span>sender: {event.data.sender}</span>}
            {event.correlationId &&
              (onFilterIncident ? (
                <Tip content="Показать всю ленту этого инцидента">
                  <button
                    type="button"
                    className={styles.metaLink}
                    onClick={() => onFilterIncident(event.correlationId as string)}
                  >
                    corr: {event.correlationId}
                  </button>
                </Tip>
              ) : (
                <span>corr: {event.correlationId}</span>
              ))}
            <span>id: {event.id}</span>
          </div>
          {detail && <pre className={styles.data}>{detail}</pre>}
        </div>
      )}
    </div>
  );
}
