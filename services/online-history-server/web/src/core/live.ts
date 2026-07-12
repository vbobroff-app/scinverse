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
 */
export function createLiveStream(
  url?: string,
  onReconnect?: () => void,
): Observable<LiveEvent> {
  const wsUrl = url ?? defaultWsUrl();
  let hadConnection = false;
  return webSocket<LiveEvent>({
    url: wsUrl,
    openObserver: {
      next: () => {
        if (hadConnection) {
          onReconnect?.();
        }
        hadConnection = true;
      },
    },
  }).pipe(
    retry({ delay: 2000 }),
    share({ resetOnRefCountZero: false }),
  );
}
