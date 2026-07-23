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
  onOpen?: (event: NotificationEvent) => void;
  /** Клик по Id инцидента (`correlationId`) — фильтрует ленту до этого инцидента. */
  onFilterIncident?: (correlationId: string) => void;
}

const SEVERITY_LABEL: Record<NotificationSeverity, string> = {
  ok: 'OK:',
  info: 'INFO:',
  warning: 'WARNING:',
  error: 'ERROR:',
  critical: 'FATAL:',
};

/**
 * Фон-маска (ось lifecycle × severity, ортогонально unread-рамке):
 * `resolved` — зелёная (перекрывает severity); иначе открытый `warning` — жёлтая,
 * `error`/`critical` — красная; `info`/`ok` без маски (нечего разрешать).
 */
function backgroundClass(event: NotificationEvent): string {
  if (resolveStatus(event) === 'resolved') {
    return styles.bgResolved;
  }
  if (event.severity === 'warning') {
    return styles.bgWarning;
  }
  if (event.severity === 'error' || event.severity === 'critical') {
    return styles.bgAlert;
  }
  return '';
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
