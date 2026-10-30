// /api/sync with Upstash mocked in memory: no real network traffic.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
const { default: handler } = await import('../../api/sync.js');
const guard = await import('../../api/_lib/guard.js');

let redis; let expires; let redisDown;
globalThis.fetch = async (url, opts = {}) => {
  if (String(url) !== 'https://redis.test/pipeline') throw new Error(`unexpected network call to ${url}`);
  if (redisDown) return new Response('down', { status: 503 });
  const out = JSON.parse(opts.body).map(([cmd, key, ...args]) => {
    switch (cmd) {
      case 'GET': return { result: redis.has(key) ? redis.get(key) : null };
      case 'SET': redis.set(key, args[0]); if (args[1] === 'EX') expires.set(key, Number(args[2])); return { result: 'OK' };
      case 'EXISTS': return { result: redis.has(key) ? 1 : 0 };
      case 'DEL': return { result: redis.delete(key) ? 1 : 0 };
      case 'EXPIRE': expires.set(key, Number(args[0])); return { result: 1 };
      case 'INCR': redis.set(key, String((Number(redis.get(key)) || 0) + 1)); return { result: Number(redis.get(key)) };
      default: return { error: `unsupported ${cmd}` };
    }
  });
  return new Response(JSON.stringify(out), { status: 200 });
};

async function call(body, { ip = '203.0.113.7', headers = {}, method = 'POST' } = {}) {
  const res = { statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; } };
  await handler({ method, body, headers: { 'content-type': 'application/json', 'x-vercel-forwarded-for': ip, ...headers }, socket: {} }, res);
  return res;
}

const NEW = 'ABCDEFGHJKLM';
const DATA = { unmet_habits: [{ id: 'h1', name: 'Read', history: {} }] };

beforeEach(() => { redis = new Map(); expires = new Map(); redisDown = false; guard._resetMemoryForTests(); });

test('push to a new 12-char code, then pull it back with revision and expiry', async () => {
  const push = await call({ action: 'push', code: NEW, data: DATA });
  assert.equal(push.statusCode, 200);
  assert.equal(push.body.rev, 1);
  assert.equal(expires.get(`unmet:sync:${NEW}`), 180 * 86400);
  const pull = await call({ action: 'pull', code: NEW });
  assert.equal(pull.statusCode, 200);
  assert.deepEqual(pull.body.data, DATA);
  assert.equal(pull.body.rev, 1);
  assert.ok(Date.parse(pull.body.expiresAt) > Date.now());
});

test('new codes must be 12 characters; existing shorter codes keep working', async () => {
  assert.equal((await call({ action: 'push', code: 'ABCDEFGH', data: DATA })).body.code, 'code_too_short');
  redis.set('unmet:sync:ABCDEFGH', JSON.stringify(DATA)); // a legacy code created before this change
  assert.equal((await call({ action: 'pull', code: 'ABCDEFGH' })).statusCode, 200);
  assert.equal((await call({ action: 'push', code: 'ABCDEFGH', data: DATA })).statusCode, 200);
});

test('pulling refreshes the 180-day expiry', async () => {
  redis.set(`unmet:sync:${NEW}`, JSON.stringify(DATA));
  expires.set(`unmet:sync:${NEW}`, 5);
  await call({ action: 'pull', code: NEW });
  assert.equal(expires.get(`unmet:sync:${NEW}`), 180 * 86400);
});

test('guessing is stopped: 10 wrong codes per hour, then even a valid code is refused', async () => {
  redis.set(`unmet:sync:${NEW}`, JSON.stringify(DATA));
  for (let i = 0; i < 10; i++) {
    assert.equal((await call({ action: 'pull', code: `WRONGCODE${String(i).padStart(3, 'A')}` })).statusCode, 404);
  }
  const blocked = await call({ action: 'pull', code: NEW });
  assert.equal(blocked.statusCode, 429);
  assert.ok(Number(blocked.headers['retry-after']) > 0);
  assert.equal((await call({ action: 'pull', code: NEW }, { ip: '198.51.100.4' })).statusCode, 200); // other clients fine
});

test('a stale push is refused instead of overwriting newer data; legacy pushes without a revision still work', async () => {
  await call({ action: 'push', code: NEW, data: DATA }); // rev 1 (device A)
  assert.equal((await call({ action: 'push', code: NEW, data: DATA, baseRev: 1 })).body.rev, 2); // device B, up to date
  const stale = await call({ action: 'push', code: NEW, data: { unmet_habits: [] }, baseRev: 1 }); // device A again, stale
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.body.code, 'conflict');
  assert.deepEqual(JSON.parse(redis.get(`unmet:sync:${NEW}`)), DATA); // newer data kept
  assert.equal((await call({ action: 'push', code: NEW, data: DATA })).statusCode, 200); // old client: no baseRev
});

test('delete removes the server copy', async () => {
  await call({ action: 'push', code: NEW, data: DATA });
  assert.equal((await call({ action: 'delete', code: NEW })).statusCode, 200);
  assert.equal(redis.has(`unmet:sync:${NEW}`), false);
  assert.equal(redis.has(`unmet:syncmeta:${NEW}`), false);
  assert.equal((await call({ action: 'pull', code: NEW })).statusCode, 404);
});

test('rate limits: pulls, pushes and new-code creation per client', async () => {
  for (let i = 0; i < 10; i++) {
    const code = `NEWCODE${String(i).padStart(5, 'A')}`.slice(0, 12);
    assert.equal((await call({ action: 'push', code, data: DATA })).statusCode, 200, code);
  }
  assert.equal((await call({ action: 'push', code: 'ELEVENTHCODE', data: DATA })).statusCode, 429);
  redis.set(`unmet:sync:${NEW}`, JSON.stringify(DATA));
  for (let i = 0; i < 60; i++) await call({ action: 'pull', code: NEW }, { ip: '192.0.2.50' });
  assert.equal((await call({ action: 'pull', code: NEW }, { ip: '192.0.2.50' })).statusCode, 429);
});

test('input checks', async () => {
  assert.equal((await call({ action: 'pull', code: NEW }, { method: 'GET' })).statusCode, 405);
  assert.equal((await call({ action: 'pull', code: NEW }, { headers: { 'content-type': 'text/plain' } })).statusCode, 415);
  assert.equal((await call({ action: 'pull', code: NEW }, { headers: { origin: 'https://evil.example' } })).statusCode, 403);
  assert.equal((await call({ action: 'steal', code: NEW })).statusCode, 400);
  assert.equal((await call({ action: 'pull', code: 'abc' })).statusCode, 400);
  assert.equal((await call({ action: 'pull', code: '<script>' })).statusCode, 400);
  assert.equal((await call({ action: 'push', code: NEW, data: ['x'] })).statusCode, 400);
  assert.equal((await call({ action: 'push', code: NEW, data: { big: 'x'.repeat(2_000_001) } })).statusCode, 413);
});

test('errors are generic and raw IPs are never stored', async () => {
  await call({ action: 'push', code: NEW, data: DATA }, { ip: '203.0.113.99' });
  for (const k of redis.keys()) assert.ok(!k.includes('203.0.113.99'), k);
  redisDown = true;
  const res = await call({ action: 'pull', code: NEW });
  assert.equal(res.statusCode, 503);
  assert.ok(!JSON.stringify(res.body).includes('redis'));
});
