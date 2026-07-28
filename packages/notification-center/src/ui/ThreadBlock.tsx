import { useEffect, useRef } from 'react';
import type { FormatTs } from '../format/formatTs';
import type { NcMarks, NotificationEvent, ThreadItem } from '../types';
import { BreakIncidentIcon } from './BreakIncidentIcon';
import { GroupStackIcon } from './GroupStackIcon';
import { IncidentFlameIcon } from './IncidentFlameIcon';
import { NotificationRow } from './NotificationRow';
import { Tip } from './Tooltip';
import styles from './ThreadBlock.module.css';

/** crash (Host outage) vs break (link) — по data.kind / кодам Entry. */
function isCrashThread(thread: ThreadItem): boolean {
  return thread.notifications.some((e) => {
    if (e.data?.kind === 'crash') {
      return true;
    }
    return (
      e.code === 'backend.unavailable' ||
      e.code === 'backend.recovering' ||
      e.code === 'backend.recovered'
    );
  });
}

interface Props {
  thread: ThreadItem;
  formatTs: FormatTs;
  expanded: boolean;
  onToggleExpanded: () => void;
  showStatusLogo?: boolean;
  showType?: boolean;
  /** Непрочитанность по Entry id. */
  isEntryUnread?: (id: string) => boolean;
  /** Маркеры Entry (уже с учётом legacy thread.uid). */
  getEntryMarks?: (entryId: string) => NcMarks;
  onOpenEntry?: (event: NotificationEvent) => void;
  onFilterIncident?: (correlationId: string) => void;
  /** Bulk header: any★ / all⊘. */
  onToggleFavorite?: () => void;
  onToggleLeft?: () => void;
  onToggleEntryFavorite?: (entryId: string) => void;
  onToggleEntryLeft?: (entryId: string) => void;
}

const STATUS_LABEL: Record<ThreadItem['threadStatus'], string> = {
  active: 'active',
  recovering: 'recovering',
  resolved: 'resolved',
};

function statusPaneClass(status: ThreadItem['threadStatus']): string {
  if (status === 'resolved') {
    return styles.statusResolved;
  }
  if (status === 'recovering') {
    return styles.statusRecovering;
  }
  return styles.statusActive;
}

export function ThreadBlock({
  thread,
  formatTs,
  expanded,
  onToggleExpanded,
  showStatusLogo = true,
  showType = true,
  isEntryUnread,
  getEntryMarks,
  onOpenEntry,
  onFilterIncident,
  onToggleFavorite,
  onToggleLeft,
  onToggleEntryFavorite,
  onToggleEntryLeft,
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
      className={styles.thread}
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

        {kindBadge === 'incident' ? (
          isCrashThread(thread) ? (
            <IncidentFlameIcon
              title="Incident (crash)"
              className={
                thread.threadStatus !== 'resolved' ? styles.incidentIconPulse : undefined
              }
            />
          ) : (
            <BreakIncidentIcon
              title="Incident (break)"
              className={
                thread.threadStatus !== 'resolved' ? styles.incidentIconPulse : undefined
              }
            />
          )
        ) : (
          <GroupStackIcon title="Group" severity={newest?.severity} />
        )}

        <span className={styles.kindName}>{kindLabel}</span>

        <time className={styles.time} dateTime={thread.lastActivityAt}>
          {timeLabel}
        </time>

        <span
          className={[styles.status, statusPaneClass(thread.threadStatus)].join(' ')}
          data-status={thread.threadStatus}
        >
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
          <Tip
            content={
              thread.isFavorite
                ? 'Снять ★ со всех Entry'
                : 'Пометить ★ все Entry'
            }
          >
            <button
              type="button"
              className={[styles.markBtn, thread.isFavorite ? styles.markOn : ''].filter(Boolean).join(' ')}
              aria-pressed={Boolean(thread.isFavorite)}
              aria-label="Избранное (нить)"
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite?.();
              }}
            >
              ★
            </button>
          </Tip>
          <Tip
            content={
              thread.isLeft
                ? 'Снять ⊘ со всех Entry'
                : 'Пометить ⊘ все Entry'
            }
          >
            <button
              type="button"
              className={[styles.markBtn, thread.isLeft ? styles.markOnSpam : ''].filter(Boolean).join(' ')}
              aria-pressed={Boolean(thread.isLeft)}
              aria-label="Спам (нить)"
              onClick={(e) => {
                e.stopPropagation();
                onToggleLeft?.();
              }}
            >
              ⊘
            </button>
          </Tip>
        </div>
      </div>

      {expanded && (
        <div className={styles.entries}>
          {[...thread.notifications].reverse().map((entry) => {
            const entryMarks = getEntryMarks?.(entry.id) ?? {};
            return (
              <NotificationRow
                key={entry.id}
                event={entry}
                formatTs={formatTs}
                showStatusLogo={showStatusLogo}
                showType={showType}
                unread={Boolean(isEntryUnread?.(entry.id))}
                isFavorite={entryMarks.isFavorite}
                isLeft={entryMarks.isLeft}
                onToggleFavorite={
                  onToggleEntryFavorite ? () => onToggleEntryFavorite(entry.id) : undefined
                }
                onToggleLeft={onToggleEntryLeft ? () => onToggleEntryLeft(entry.id) : undefined}
                onOpen={onOpenEntry}
                onFilterIncident={onFilterIncident}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
