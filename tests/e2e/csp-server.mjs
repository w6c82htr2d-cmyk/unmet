// Serves the production build with the exact headers from vercel.json, and runs the real API
// handlers with Anthropic and Upstash simulated in memory. Test harness only.
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
const ROOT = process.argv[2];
const PORT = Number(process.argv[3] || 8092);
const vercel = JSON.parse(readFileSync(process.env.VERCEL_JSON || '/home/user/unmet/vercel.json', 'utf8'));
const HEADERS = vercel.headers[0].headers;
process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test';
process.env.UPSTASH_REDIS_REST_TOKEN = 't';
const redis = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url) === 'https://redis.test/pipeline') {
    const out = JSON.parse(opts.body).map(([cmd, key, ...a]) => ({ result: ({ GET: () => redis.get(key) ?? null, SET: () => (redis.set(key, a[0]), 'OK'), EXISTS: () => (redis.has(key) ? 1 : 0), DEL: () => (redis.delete(key) ? 1 : 0), EXPIRE: () => 1, HINCRBY: () => 1, INCR: () => { redis.set(key, String((Number(redis.get(key)) || 0) + 1)); return Number(redis.get(key)); } })[cmd]() }));
    return new Response(JSON.stringify(out));
  }
  if (String(url) === 'https://api.anthropic.com/v1/messages') {
    const goals = { goals: [{ id: 'g0', text: 'Learn French', importance: 'medium', urgency: 'low', firstStep: { type: 'stack', label: 'Practice after class' } }] };
    return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(goals) }], usage: { input_tokens: 100, output_tokens: 50 } }));
  }
  return realFetch(url, opts);
};
const plan = (await import('/home/user/unmet/api/plan.js')).default;
const sync = (await import('/home/user/unmet/api/sync.js')).default;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const testOnly = url.pathname === '/seed.html'; // seeding page: test harness, not part of the site
  if (!testOnly) for (const h of HEADERS) res.setHeader(h.key, h.value);
  if (url.pathname.startsWith('/api/')) {
    let raw = ''; for await (const c of req) raw += c;
    let body; try { body = JSON.parse(raw); } catch { body = raw; }
    const out = { statusCode: 200, setHeader: (k, v) => res.setHeader(k, v), status(c) { this.statusCode = c; return this; }, json(b) { res.statusCode = this.statusCode; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(b)); return this; } };
    const handler = url.pathname === '/api/plan' ? plan : url.pathname === '/api/sync' ? sync : null;
    if (!handler) { res.statusCode = 404; return res.end(); }
    return handler({ method: req.method, headers: { ...req.headers, 'x-vercel-forwarded-for': '203.0.113.5' }, body, socket: {} }, out);
  }
  let file = join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(ROOT, 'index.html');
  res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
}).listen(PORT, () => console.log('csp test server on', PORT));
