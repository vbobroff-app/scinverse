import { retry, share, type Observable } from 'rxjs';
import { webSocket } from 'rxjs/webSocket';
import type { LiveEvent } from './types';

function defaultWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

/** Маппинг состояния связи коннектора → статус подключения в UI (phase 7h.5). */
export function linkStateToConnectionStatus(state: string): string {
  switch (state) {
    case 'Live':
      return 'waiting';
    case 'Degraded':
      return 'degraded';
    case 'Error':
      return 'error';
    case 'Down':
    default:
      return 'disconnected';
  }
}

/**
 * Поток live-событий OHS по WebSocket `/ws` с авто-переподключением.
 * `share()` — единый сокет на всех подписчиков.
 *
 * `onDrop` — закрытие сокета ПОСЛЕ того, как связь однажды была установлена (краш/недоступность).
 * Первичный неуспех коннекта drop'ом не считаем.
 * `onOpen` — каждое успешное открытие, **включая первое** (иначе после reload/HMR pending
 * `ohs.hostOutage.pending` с `to=null` не досылается: start() зовёт flush только для уже
 * закрытых, а «reconnect-only» open пропускал POST /recovery/outage).
 * `retry` каждые 2 c → `onDrop` может повторяться; дедуп на стороне подписчика.
 */
export function createLiveStream(
  url?: string,
  onOpen?: () => void,
  onDrop?: () => void,
): Observable<LiveEvent> {
  const wsUrl = url ?? defaultWsUrl();
  let hadConnection = false;
  return webSocket<LiveEvent>({
    url: wsUrl,
    openObserver: {
      next: () => {
        // Всегда: flush pending outage + refresh SoT (первый open после reload тоже).
        onOpen?.();
        hadConnection = true;
      },
    },
    closeObserver: {
      next: () => {
        if (hadConnection) {
          onDrop?.();
        }
      },
    },
  }).pipe(
    retry({ delay: 2000 }),
    share({ resetOnRefCountZero: false }),
  );
}
