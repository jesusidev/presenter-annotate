import { type ClientMessage, parseMessage, type ServerMessage, type Transport } from './types';

/**
 * The bundled WebSocket transport.
 *
 * Good enough for a site you are presenting from your own machine. An app with
 * its own authenticated socket should NOT use this — it would open a second,
 * unprotected connection alongside the one it already trusts. Implement
 * `Transport` against the existing socket instead; that is the whole point of
 * the seam.
 */

export type WebSocketTransportOptions = {
  url: string;
  /** Which room to join. Everyone sharing a room sees each other's marks. */
  room?: string;
  /** Backoff ceiling. Tunnels drop connections more often than localhost. */
  maxRetryMs?: number;
};

export function createWebSocketTransport(options: WebSocketTransportOptions): Transport {
  const handlers = new Set<(message: ServerMessage) => void>();
  const queue: ClientMessage[] = [];
  const maxRetryMs = options.maxRetryMs ?? 8000;

  let socket: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const url = () => {
    const u = new URL(options.url, typeof location === 'undefined' ? undefined : location.href);
    if (options.room) u.searchParams.set('room', options.room);
    return u.toString();
  };

  function connect() {
    if (closed) return;
    let next: WebSocket;
    try {
      next = new WebSocket(url());
    } catch {
      return retry();
    }
    socket = next;

    next.addEventListener('open', () => {
      attempt = 0;
      // Anything queued while disconnected goes out now, in order.
      while (queue.length > 0) {
        const message = queue.shift();
        if (message) next.send(JSON.stringify(message));
      }
    });

    next.addEventListener('message', (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const message = parseMessage(parsed);
      if (!message) return;
      for (const handler of handlers) handler(message);
    });

    next.addEventListener('close', retry);
    // 'error' is always followed by 'close', so retrying here would double up.
    next.addEventListener('error', () => next.close());
  }

  function retry() {
    if (closed) return;
    socket = null;
    // Exponential backoff with jitter — tunnels drop several clients at once,
    // and without jitter they all reconnect on the same tick.
    const delay = Math.min(maxRetryMs, 2 ** attempt * 250) * (0.7 + Math.random() * 0.6);
    attempt += 1;
    timer = setTimeout(connect, delay);
  }

  connect();

  return {
    send(message) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
        return;
      }
      // Live previews are worthless once stale, so they are dropped rather than
      // queued — a committed mark is what has to survive a blip.
      if (message.type !== 'annotate-live') queue.push(message);
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      socket?.close();
      handlers.clear();
    },
  };
}

/** A transport that goes nowhere. Useful for solo drawing and for tests. */
export function createLocalTransport(): Transport {
  const handlers = new Set<(message: ServerMessage) => void>();
  return {
    send() {
      /* nowhere to send */
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    close() {
      handlers.clear();
    },
  };
}
