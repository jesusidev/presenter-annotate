#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachRelay, relayStats } from '../server/relay.mjs';

/**
 * `npx presenter-annotate serve`
 *
 * Runs the relay and serves the embed script, so a site that is not yours to
 * rebuild can still get the overlay with one script tag.
 */

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const command = args[0] ?? 'serve';

if (command !== 'serve') {
  console.error(`Unknown command "${command}". The only command is: serve`);
  process.exit(1);
}

const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
};

const port = Number(flag('port', process.env.PORT ?? '7420'));

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (url.pathname === '/embed.js') {
    let body;
    try {
      body = readFileSync(join(here, '..', 'dist', 'embed.global.js'));
    } catch {
      response.writeHead(500, { 'content-type': 'text/plain' });
      response.end('embed.global.js is missing — run `npm run build` in presenter-annotate.');
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      // The whole point is dropping this into another origin's page.
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    });
    response.end(body);
    return;
  }

  if (url.pathname === '/status') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ rooms: relayStats() }, null, 2));
    return;
  }

  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('presenter-annotate: /embed.js, /status, ws /annotate');
});

attachRelay(server, { path: '/annotate' });

server.listen(port, () => {
  const line = '─'.repeat(64);
  console.log(`\n${line}`);
  console.log('  presenter-annotate');
  console.log('');
  console.log(`  relay      ws://localhost:${port}/annotate`);
  console.log(`  embed      http://localhost:${port}/embed.js`);
  console.log('');
  console.log('  Drop this into any page you are presenting:');
  console.log('');
  console.log(
    `      <script src="http://localhost:${port}/embed.js" data-present></script>`
  );
  console.log('');
  console.log('  Viewers load the same page WITHOUT data-present.');
  console.log('');
  console.log('  ⚠ No authentication. Anyone who can reach the port can draw.');
  console.log('    Fine behind a tunnel you take down afterwards; not for');
  console.log('    anything public or long-lived.');
  console.log(`${line}\n`);
});
