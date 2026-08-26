import { WebSocketServer } from 'ws';

/**
 * The annotation relay.
 *
 * Deliberately small and deliberately dumb: it holds the committed shapes per
 * room, forwards live strokes without storing them, and replays what it has to
 * anyone who joins. It knows nothing about who you are.
 *
 * That last part matters, so it is said plainly rather than left to be
 * discovered: THERE IS NO AUTHENTICATION HERE. Anyone who can reach the port
 * can draw. That is fine for a laptop and a tunnel you take down afterwards; it
 * is not fine for anything long-lived or public. An app with real users should
 * implement the Transport interface against its own authenticated socket
 * instead of running this.
 */

/** Per room: the committed shapes, oldest first. */
const rooms = new Map();

/** Stop one room's history growing without bound during a long session. */
const MAX_SHAPES = 500;

function roomOf(name) {
  let room = rooms.get(name);
  if (!room) {
    room = { shapes: [], sockets: new Set() };
    rooms.set(name, room);
  }
  return room;
}

function isShape(value) {
  if (typeof value !== 'object' || value === null) return false;
  const { id, scope, tool, color, points } = value;
  return (
    typeof id === 'string' &&
    typeof scope === 'string' &&
    typeof color === 'string' &&
    ['arrow', 'box', 'pen', 'highlight'].includes(tool) &&
    Array.isArray(points) &&
    points.length > 0 &&
    points.length <= 4000 &&
    points.every(
      (p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
    )
  );
}

function send(socket, message) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

export function attachRelay(server, { path = '/annotate' } = {}) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    let url;
    try {
      url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
    } catch {
      return socket.destroy();
    }
    if (url.pathname !== path) return;

    wss.handleUpgrade(request, socket, head, (ws) => {
      const name = url.searchParams.get('room') ?? 'default';
      const room = roomOf(name);
      room.sockets.add(ws);

      const broadcast = (message, except) => {
        for (const peer of room.sockets) {
          if (peer !== except) send(peer, message);
        }
      };

      // Catch the newcomer up. Someone joining ten minutes in should see the
      // marks already on the page, not an empty overlay.
      if (room.shapes.length > 0) send(ws, { type: 'annotations', shapes: room.shapes });

      ws.on('message', (raw) => {
        let message;
        try {
          message = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (typeof message !== 'object' || message === null) return;

        switch (message.type) {
          case 'annotate-live': {
            // Forwarded, never stored — a half-finished arrow must not survive
            // the drawer disconnecting mid-stroke.
            if (!isShape(message.shape)) return;
            broadcast({ type: 'annotate-live', shape: message.shape }, ws);
            return;
          }

          case 'annotate': {
            if (!isShape(message.shape)) return;
            room.shapes = room.shapes.filter((s) => s.id !== message.shape.id);
            room.shapes.push(message.shape);
            if (room.shapes.length > MAX_SHAPES) room.shapes.shift();
            broadcast({ type: 'annotate', shape: message.shape }, ws);
            return;
          }

          case 'annotate-undo': {
            const scope = typeof message.scope === 'string' ? message.scope : null;
            // Remove the newest mark in that scope. The relay has no identity,
            // so "your last mark" is resolved client-side and this is the
            // best it can do — which is why undo is scoped, not global.
            for (let i = room.shapes.length - 1; i >= 0; i -= 1) {
              if (scope === null || room.shapes[i].scope === scope) {
                const [removed] = room.shapes.splice(i, 1);
                broadcast({ type: 'annotate-undo', id: removed.id }, ws);
                return;
              }
            }
            return;
          }

          case 'annotate-clear': {
            const scope = typeof message.scope === 'string' ? message.scope : null;
            room.shapes = scope === null ? [] : room.shapes.filter((s) => s.scope !== scope);
            broadcast({ type: 'annotate-clear', scope }, ws);
            return;
          }

          default:
            return;
        }
      });

      ws.on('close', () => {
        room.sockets.delete(ws);
        // Keep the shapes: the presenter reloading should not wipe the board.
        // Drop the room only once nobody is left AND it holds nothing.
        if (room.sockets.size === 0 && room.shapes.length === 0) rooms.delete(name);
      });
    });
  });

  return wss;
}

/** Room stats, for the CLI's boot log and for tests. */
export function relayStats() {
  return [...rooms.entries()].map(([name, room]) => ({
    room: name,
    clients: room.sockets.size,
    shapes: room.shapes.length,
  }));
}

/** Exported so tests can start from a known state. */
export function resetRelay() {
  rooms.clear();
}
