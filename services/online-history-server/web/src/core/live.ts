import { retry, share, type Observable } from 'rxjs';
import { webSocket } from 'rxjs/webSocket';
import type { LiveEvent } from './types';

function defaultWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

/**
 * Поток live-событий OHS по WebSocket `/ws` с авто-переподключением.
 * `share()` — единый сокет на всех подписчиков.
 */
export function createLiveStream(url: string = defaultWsUrl()): Observable<LiveEvent> {
  return webSocket<LiveEvent>({ url }).pipe(
    retry({ delay: 2000 }),
    share({ resetOnRefCountZero: false }),
  );
}
