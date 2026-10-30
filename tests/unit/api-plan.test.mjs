// /api/plan with every outbound call mocked: no real Anthropic or Upstash traffic, no cost.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
const { default: handler } = await import('../../api/plan.js');
const guard = await import('../../api/_lib/guard.js');

const MODEL_JSON = { goals: [{ id: 'g0', text: 'Learn French', importance: 'medium', urgency: 'low', firstStep: { type: 'stack', label: 'Practice 10 min after class' } }] };
let redis; let anthropic; let calls; let redisDown;

function mockFetch() {
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), body: opts.body });
    if (String(url) === 'https://redis.test/pipeline') {
      if (redisDown) return new Response('down', { status: 503 });
      const out = JSON.parse(opts.body).map(([cmd, key, a, b]) => {
        if (cmd === 'INCR') { redis.set(key, (redis.get(key) || 0) + 1); return { result: redis.get(key) }; }
        if (cmd === 'EXPIRE') return { result: 1 };
        if (cmd === 'HINCRBY') { const h = redis.get(key) || {}; h[a] = (h[a] || 0) + Number(b); redis.set(key, h); return { result: h[a] }; }
        return { error: 'unknown' };
      });
      return new Response(JSON.stringify(out), { status: 200 });
    }
    if (String(url) === 'https://api.anthropic.com/v1/messages') return anthropic(opts);
    throw new Error(`unexpected network call to ${url}`);
  };
}

function okModel(text = JSON.stringify(MODEL_JSON)) {
  return async () => new Response(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 300, output_tokens: 120 }, stop_reason: 'end_turn' }), { status: 200 });
}

async function call({ method = 'POST', body = { text: 'I want to learn French' }, headers = {}, ip = '203.0.113.7' } = {}) {
  const res = { statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; } };
  const req = { method, body, headers: { 'content-type': 'application/json', 'x-vercel-forwarded-for': ip, ...headers }, socket: {} };
  await handler(req, res);
  return res;
}

beforeEach(() => {
  redis = new Map(); calls = []; redisDown = false; anthropic = okModel();
  guard._resetMemoryForTests();
  mockFetch();
  delete process.env.PLAN_DAILY_LIMIT;
});

test('success: response body is exactly the model JSON, request unchanged', async () => {
  const res = await call();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, MODEL_JSON);
  assert.equal(res.headers['cache-control'], 'no-store');
  const sent = JSON.parse(calls.find((c) => c.url.includes('anthropic')).body);
  assert.equal(sent.model, 'claude-haiku-4-5');
  assert.equal(sent.max_tokens, 1024);
  assert.equal(sent.messages[0].content, 'I want to learn French');
  assert.ok(sent.system.startsWith("You turn a person's free-form journal entry"));
});

test('still strips ```json fences like before', async () => {
  anthropic = okModel('```json\n' + JSON.stringify(MODEL_JSON) + '\n```');
  const res = await call();
  assert.deepEqual(res.body, MODEL_JSON);
});

test('text over 4,000 chars is still truncated to 4,000 for the model', async () => {
  await call({ body: { text: 'a'.repeat(9000) } });
  const sent = JSON.parse(calls.find((c) => c.url.includes('anthropic')).body);
  assert.equal(sent.messages[0].content.length, 4000);
});

test('input validation rejects bad requests before any AI call or rate-limit count', async () => {
  const cases = [
    [{ method: 'GET' }, 405],
    [{ headers: { 'content-type': 'text/plain' } }, 415],
    [{ body: null }, 400],
    [{ body: 'text=hi' }, 400],
    [{ body: ['x'] }, 400],
    [{ body: { text: 42 } }, 400],
    [{ body: { text: '   ' } }, 400],
    [{ body: { text: 'x'.repeat(20001) } }, 413],
  ];
  for (const [opts, status] of cases) {
    const res = await call(opts);
    assert.equal(res.statusCode, status, JSON.stringify(opts).slice(0, 60));
  }
  assert.equal(calls.length, 0);
});

test('origin check: other sites blocked, UNMET and non-browser clients pass to the limiter', async () => {
  assert.equal((await call({ headers: { origin: 'https://evil.example' } })).statusCode, 403);
  assert.equal((await call({ headers: { origin: 'http://getunmet.com' } })).statusCode, 403);
  assert.equal((await call({ headers: { origin: 'https://www.getunmet.com' } })).statusCode, 200);
  assert.equal((await call({ headers: { origin: 'http://localhost:5173' } })).statusCode, 200);
  assert.equal((await call({})).statusCode, 200);
});

test('per-client burst limit: 10 per 10 minutes, then 429 with Retry-After; other clients unaffected', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await call()).statusCode, 200);
  const blocked = await call();
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.code, 'rate_limited');
  assert.ok(Number(blocked.headers['retry-after']) > 0);
  assert.equal((await call({ ip: '198.51.100.9' })).statusCode, 200);
  const aiCalls = calls.filter((c) => c.url.includes('anthropic')).length;
  assert.equal(aiCalls, 11); // the blocked request never reached Anthropic
});

test('global daily cap applies across all clients', async () => {
  process.env.PLAN_DAILY_LIMIT = '3';
  for (let i = 0; i < 3; i++) assert.equal((await call({ ip: `192.0.2.${i}` })).statusCode, 200);
  assert.equal((await call({ ip: '192.0.2.200' })).statusCode, 429);
});

test('raw IPs are never stored', async () => {
  await call({ ip: '203.0.113.7' });
  for (const key of redis.keys()) assert.ok(!key.includes('203.0.113.7'), key);
});

test('when Redis is down, an in-memory limiter still enforces limits', async () => {
  redisDown = true;
  for (let i = 0; i < 10; i++) assert.equal((await call()).statusCode, 200);
  assert.equal((await call()).statusCode, 429);
});

test('errors are generic: no upstream body, raw model text or exception details leak', async () => {
  anthropic = async () => new Response('{"error":{"message":"secret upstream detail"}}', { status: 500 });
  let res = await call();
  assert.equal(res.statusCode, 502);
  assert.ok(!JSON.stringify(res.body).includes('secret'));

  anthropic = okModel('not json, includes the user text: I want to learn French');
  res = await call();
  assert.equal(res.statusCode, 502);
  assert.ok(!JSON.stringify(res.body).includes('learn French'));

  anthropic = async () => { throw new Error('ECONNRESET internal host 10.0.0.1'); };
  res = await call();
  assert.equal(res.statusCode, 500);
  assert.ok(!JSON.stringify(res.body).includes('10.0.0.1'));

  anthropic = async () => { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e; };
  res = await call();
  assert.equal(res.statusCode, 504);
});

test('missing API key gives a generic 503 and makes no AI call', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const res = await call();
    assert.equal(res.statusCode, 503);
    assert.ok(!JSON.stringify(res.body).includes('ANTHROPIC'));
    assert.equal(calls.filter((c) => c.url.includes('anthropic')).length, 0);
  } finally {
    process.env.ANTHROPIC_API_KEY = saved;
  }
});

test('usage monitoring records counts and tokens only', async () => {
  await call();
  await call();
  const day = new Date().toISOString().slice(0, 10);
  const usage = redis.get(`unmet:usage:plan:${day}`);
  assert.deepEqual(usage, { calls: 2, input_tokens: 600, output_tokens: 240 });
});

test('function logs never contain journal text or the API key', async () => {
  const lines = [];
  const realLog = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    const secretText = 'my private journal about my exam anxiety';
    await call({ body: { text: secretText } });
    anthropic = okModel('garbage ' + secretText);
    await call({ body: { text: secretText } });
    anthropic = async () => new Response(secretText, { status: 500 });
    await call({ body: { text: secretText } });
    redisDown = true;
    await call({ body: { text: secretText } });
  } finally {
    console.log = realLog;
  }
  const all = lines.join('\n');
  assert.ok(lines.length >= 3);
  assert.ok(!all.includes('exam anxiety'));
  assert.ok(!all.includes('test-key-not-real'));
});
