import { useEffect, useRef, useState } from 'react';
import type { NotificationEvent } from '../types';
import type { FormatTs } from '../format/formatTs';
import { InteractionIcon } from './InteractionIcon';
import { SeverityIcon } from './SeverityIcon';
import styles from './NotificationRow.module.css';

interface Props {
  event: NotificationEvent;
  formatTs: FormatTs;
  unread?: boolean;
  onOpen?: (event: NotificationEvent) => void;
}

function detailText(event: NotificationEvent): string | null {
  if (!event.data || Object.keys(event.data).length === 0) {
    return null;
  }
  try {
    return JSON.stringify(event.data, null, 2);
  } catch {
    return String(event.data);
  }
}

export function NotificationRow({ event, formatTs, unread, onOpen }: Props) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const detail = detailText(event);

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
      className={[styles.row, unread ? styles.unread : '', styles[event.severity]].filter(Boolean).join(' ')}
    >
      <div className={styles.main}>
        <button
          type="button"
          className={styles.expandBtn}
          onClick={toggle}
          aria-expanded={expanded}
          title={expanded ? 'Свернуть' : 'Подробности'}
        >
          <span className={[styles.chevron, expanded ? styles.chevronOpen : ''].filter(Boolean).join(' ')}>
            ▸
          </span>
        </button>
        <SeverityIcon severity={event.severity} />
        <time className={styles.time} dateTime={event.ts}>
          {formatTs(event.ts)}
        </time>
        <InteractionIcon event={event} />
        <span className={[styles.message, expanded ? styles.messageWrap : ''].filter(Boolean).join(' ')}>
          {event.message}
        </span>
        <button type="button" className={styles.copyBtn} onClick={copy} title="Копировать">
          ⎘
        </button>
      </div>
      {expanded && (
        <div className={styles.detail}>
          <div className={styles.meta}>
            <span>code: {event.code}</span>
            {event.correlationId && <span>corr: {event.correlationId}</span>}
            <span>id: {event.id}</span>
          </div>
          {detail && <pre className={styles.data}>{detail}</pre>}
        </div>
      )}
    </div>
  );
}
