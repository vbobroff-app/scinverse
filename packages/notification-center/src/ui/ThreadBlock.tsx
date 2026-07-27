import { useEffect, useRef } from 'react';
import type { FormatTs } from '../format/formatTs';
import type { NotificationEvent, ThreadItem } from '../types';
import { NotificationRow } from './NotificationRow';
import { Tip } from './Tooltip';
import styles from './ThreadBlock.module.css';

interface Props {
  thread: ThreadItem;
  formatTs: FormatTs;
  expanded: boolean;
  onToggleExpanded: () => void;
  showStatusLogo?: boolean;
  showType?: boolean;
  /** Непрочитанность по Entry id. */
  isEntryUnread?: (id: string) => boolean;
  onOpenEntry?: (event: NotificationEvent) => void;
  onFilterIncident?: (correlationId: string) => void;
  onToggleFavorite?: () => void;
  onToggleLeft?: () => void;
}

const STATUS_LABEL: Record<ThreadItem['threadStatus'], string> = {
  active: 'active',
  recovering: 'recovering',
  resolved: 'resolved',
};

function statusStripClass(status: ThreadItem['threadStatus']): string {
  if (status === 'resolved') {
    return styles.stripResolved;
  }
  if (status === 'recovering') {
    return styles.stripRecovering;
  }
  return styles.stripActive;
}

export function ThreadBlock({
  thread,
  formatTs,
  expanded,
  onToggleExpanded,
  showStatusLogo = true,
  showType = true,
  isEntryUnread,
  onOpenEntry,
  onFilterIncident,
  onToggleFavorite,
  onToggleLeft,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const newest = thread.notifications[thread.notifications.length - 1];
  const lastMessage = newest?.message ?? thread.header.summary ?? '';
  const kindBadge = thread.threadKind === 'incident' ? 'incident' : 'group';
  const kindLabel = thread.threadKind === 'incident' ? 'Incident' : 'Group';

  useEffect(() => {
    if (expanded) {
      ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    }
  }, [expanded]);

  const timeLabel = thread.closedAt
    ? `${formatTs(thread.openedAt)} → ${formatTs(thread.closedAt)}`
    : formatTs(thread.lastActivityAt);

  return (
    <div
      ref={ref}
      className={[styles.thread, statusStripClass(thread.threadStatus)].filter(Boolean).join(' ')}
      data-thread-uid={thread.uid}
    >
      <div className={styles.header}>
        <button
          type="button"
          className={styles.expandBtn}
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-label={expanded ? 'Свернуть нить' : 'Раскрыть нить'}
        >
          <span
            className={[styles.chevron, expanded ? styles.chevronOpen : ''].filter(Boolean).join(' ')}
          >
            ▴
          </span>
        </button>

        <span
          className={[
            styles.kindBadge,
            kindBadge === 'incident' ? styles.kindIncident : styles.kindGroup,
          ].join(' ')}
          title={kindLabel}
        >
          {kindBadge === 'incident' ? '[!]' : '[G]'}
        </span>

        <span className={styles.kindName}>{kindLabel}</span>

        <time className={styles.time} dateTime={thread.lastActivityAt}>
          {timeLabel}
        </time>

        <span className={styles.status} data-status={thread.threadStatus}>
          {STATUS_LABEL[thread.threadStatus]}
        </span>

        <span className={styles.title} title={thread.uid}>
          {thread.header.title}
        </span>

        <span className={[styles.message, expanded ? styles.messageMuted : ''].join(' ')}>
          {lastMessage}
          {thread.notifications.length > 1 ? (
            <span className={styles.count}> · {thread.notifications.length}</span>
          ) : null}
        </span>

        <div className={styles.marks}>
          <Tip content={thread.isFavorite ? 'Снять избранное' : 'В избранное'}>
            <button
              type="button"
              className={[styles.markBtn, thread.isFavorite ? styles.markOn : ''].filter(Boolean).join(' ')}
              aria-pressed={Boolean(thread.isFavorite)}
              aria-label="Избранное"
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite?.();
              }}
            >
              ★
            </button>
          </Tip>
          <Tip content={thread.isLeft ? 'Вернуть в ленту' : 'Отложить'}>
            <button
              type="button"
              className={[styles.markBtn, thread.isLeft ? styles.markOn : ''].filter(Boolean).join(' ')}
              aria-pressed={Boolean(thread.isLeft)}
              aria-label="Отложить"
              onClick={(e) => {
                e.stopPropagation();
                onToggleLeft?.();
              }}
            >
              ⦸
            </button>
          </Tip>
        </div>
      </div>

      {expanded && (
        <div className={styles.entries}>
          {[...thread.notifications].reverse().map((entry) => (
            <NotificationRow
              key={entry.id}
              event={entry}
              formatTs={formatTs}
              showStatusLogo={showStatusLogo}
              showType={showType}
              kindBadge={kindBadge}
              unread={Boolean(isEntryUnread?.(entry.id))}
              onOpen={onOpenEntry}
              onFilterIncident={onFilterIncident}
            />
          ))}
        </div>
      )}
    </div>
  );
}
