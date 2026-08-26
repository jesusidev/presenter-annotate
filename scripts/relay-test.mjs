import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { attachRelay, resetRelay } from '../server/relay.mjs';

/**
 * Two real websocket clients through a real relay.
 *
 * The thing worth proving is not that the reducer works — it is that a mark
 * drawn in one browser arrives in another, that a late joiner is caught up,
 * and that a half-finished stroke is NOT stored. All three are protocol
 * behaviour, so they need two actual sockets rather than a unit test.
 */

let pass = 0;
let fail = 0;

const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`
  );
  ok ? (pass += 1) : (fail += 1);
};

const shape = (id, scope = '/talk', tool = 'arrow') => ({
  id,
  scope,
  tool,
  color: 'amber',
  points: [
    [0.1, 0.1],
    [0.5, 0.5],
  ],
  at: Date.now(),
  by: 'presenter',
});

resetRelay();
const server = createServer();
attachRelay(server, { path: '/annotate' });
await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;
const url = `ws://localhost:${port}/annotate?room=test`;

/** Connect and collect every message that arrives. */
function connect() {
  const socket = new WebSocket(url);
  const received = [];
  socket.on('message', (raw) => received.push(JSON.parse(String(raw))));
  return new Promise((resolve) => {
    socket.on('open', () => resolve({ socket, received }));
  });
}

const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------- draw reaches B
const a = await connect();
const b = await connect();
await settle();

a.socket.send(JSON.stringify({ type: 'annotate', shape: shape('s1') }));
await settle();

check(
  'a committed mark reaches the other client',
  b.received.filter((m) => m.type === 'annotate').map((m) => m.shape.id),
  ['s1']
);
check(
  'the drawer does not receive their own mark back',
  a.received.filter((m) => m.type === 'annotate').length,
  0
);

// --------------------------------------------------------- live is relayed
a.socket.send(JSON.stringify({ type: 'annotate-live', shape: shape('s2') }));
await settle();
check(
  'a live stroke is relayed',
  b.received.filter((m) => m.type === 'annotate-live').length,
  1
);

// ------------------------------------------- late joiner is caught up on 1
const c = await connect();
await settle();
const replay = c.received.find((m) => m.type === 'annotations');
check('a late joiner receives the stored marks', replay?.shapes.map((s) => s.id), ['s1']);
check(
  'the live stroke was NOT stored for the late joiner',
  replay?.shapes.some((s) => s.id === 's2'),
  false
);

// --------------------------------------------------------------------- undo
a.socket.send(JSON.stringify({ type: 'annotate', shape: shape('s3') }));
await settle();
a.socket.send(JSON.stringify({ type: 'annotate-undo', scope: '/talk' }));
await settle();
check(
  'undo removes the newest mark in scope',
  b.received.filter((m) => m.type === 'annotate-undo').map((m) => m.id),
  ['s3']
);

// -------------------------------------------------------- scope-aware clear
a.socket.send(JSON.stringify({ type: 'annotate', shape: shape('other', '/elsewhere') }));
await settle();
a.socket.send(JSON.stringify({ type: 'annotate-clear', scope: '/talk' }));
await settle();

const d = await connect();
await settle();
const afterClear = d.received.find((m) => m.type === 'annotations');
check(
  'clearing one scope leaves the other scope alone',
  afterClear?.shapes.map((s) => s.id),
  ['other']
);

// ------------------------------------------------------- malformed rejected
a.socket.send(JSON.stringify({ type: 'annotate', shape: { id: 'bad', points: 'nope' } }));
a.socket.send(JSON.stringify({ type: 'annotate', shape: shape('ok') }));
await settle();
const e = await connect();
await settle();
const afterBad = e.received.find((m) => m.type === 'annotations');
check(
  'a malformed shape is dropped, a valid one still lands',
  afterBad?.shapes.map((s) => s.id).sort(),
  ['ok', 'other']
);

// ------------------------------------------------- rooms are isolated
const other = new WebSocket(`ws://localhost:${port}/annotate?room=different`);
const otherReceived = [];
other.on('message', (raw) => otherReceived.push(JSON.parse(String(raw))));
await new Promise((r) => other.on('open', r));
await settle();
check('a separate room starts empty', otherReceived.length, 0);

a.socket.send(JSON.stringify({ type: 'annotate', shape: shape('roomtest') }));
await settle();
check('marks do not leak between rooms', otherReceived.length, 0);

for (const socket of [a.socket, b.socket, c.socket, d.socket, e.socket, other]) socket.close();
server.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
