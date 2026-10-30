// Abuse protection and usage monitoring shared by API routes. (Files under api/_lib are not
// deployed as endpoints — Vercel skips paths starting with an underscore.)
//
// - Rate limits are fixed-window counters in Upstash Redis (the same store /api/sync uses). If
//   Redis isn't configured or is unreachable, a per-instance in-memory counter takes over so the
//   limits still apply (less precisely) instead of failing open or taking the feature down.
// - Clients are identified by a salted SHA-256 of their IP; raw IPs are never stored.
// - Usage monitoring stores only daily counts and token totals — never request text.
import { createHash } from 'node:crypto';

const memory = new Map(); // key -> { count, resetAt }

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

export async function redisPipeline(commands) {
  const cfg = redisConfig();
  if (!cfg) throw new Error('redis-not-configured');
  const res = await fetch(`${cfg.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`redis-http-${res.status}`);
  const out = await res.json();
  if (!Array.isArray(out) || out.some((r) => r && r.error)) throw new Error('redis-command-error');
  return out.map((r) => r.result);
}

// The client IP as seen by Vercel's edge. Vercel overwrites these headers, so a client can't
// choose its own value; the fallbacks cover local development.
export function clientIp(req) {
  const h = req.headers || {};
  const first = (v) => (Array.isArray(v) ? v[0] : v || '').split(',')[0].trim();
  return first(h['x-vercel-forwarded-for']) || first(h['x-real-ip']) || first(h['x-forwarded-for'])
    || req.socket?.remoteAddress || 'unknown';
}

export function hashClient(ip) {
  const salt = process.env.RATE_LIMIT_SALT || 'unmet-rate-limit';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

function memoryHit(key, windowSec, now) {
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + windowSec * 1000 };
    memory.set(key, fresh);
    if (memory.size > 5000) {
      for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
    }
    return fresh;
  }
  entry.count += 1;
  return entry;
}

// limits: [{ name, key, limit, windowSec }]. Counts this request against every limit and returns
// { allowed, retryAfter, limit, store }. Windows are aligned to the clock so keys expire cleanly.
export async function checkRateLimits(limits, now = Date.now()) {
  const keyed = limits.map((l) => {
    const windowStart = Math.floor(now / 1000 / l.windowSec) * l.windowSec;
    return { ...l, redisKey: `${l.key}:${windowStart}`, resetAt: (windowStart + l.windowSec) * 1000 };
  });
  let counts;
  let store = 'redis';
  try {
    const commands = [];
    for (const l of keyed) {
      commands.push(['INCR', l.redisKey]);
      commands.push(['EXPIRE', l.redisKey, String(l.windowSec + 60)]);
    }
    const results = await redisPipeline(commands);
    counts = keyed.map((_, i) => Number(results[i * 2]));
  } catch (err) {
    store = 'memory';
    if (err.message !== 'redis-not-configured') logEvent('rate_limit_store_error', { reason: err.message });
    counts = keyed.map((l) => memoryHit(l.redisKey, l.windowSec, now).count);
  }
  for (let i = 0; i < keyed.length; i++) {
    if (counts[i] > keyed[i].limit) {
      return { allowed: false, limit: keyed[i].name, retryAfter: Math.max(1, Math.ceil((keyed[i].resetAt - now) / 1000)), store };
    }
  }
  return { allowed: true, store };
}

// Reads a limit's current count without counting this request (e.g. "has this client already used
// up its wrong-code allowance?"). Same store and fallback as checkRateLimits.
export async function isOverLimit(l, now = Date.now()) {
  const windowStart = Math.floor(now / 1000 / l.windowSec) * l.windowSec;
  const key = `${l.key}:${windowStart}`;
  let count;
  try {
    const [value] = await redisPipeline([['GET', key]]);
    count = Number(value) || 0;
  } catch {
    const entry = memory.get(key);
    count = entry && entry.resetAt > now ? entry.count : 0;
  }
  return count >= l.limit;
}

// Daily aggregate counters (kept 90 days). Best effort: monitoring must never break a request.
export async function recordUsage(route, fields, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const key = `unmet:usage:${route}:${day}`;
  const commands = Object.entries(fields)
    .filter(([, v]) => Number.isFinite(v) && v !== 0)
    .map(([field, v]) => ['HINCRBY', key, field, String(Math.round(v))]);
  if (!commands.length) return;
  commands.push(['EXPIRE', key, String(90 * 86400)]);
  try {
    await redisPipeline(commands);
  } catch {
    // Not configured or unavailable: the structured log line below is the fallback record.
  }
}

// One JSON line per event in the function logs. Callers must never pass user text or secrets.
export function logEvent(event, data = {}) {
  console.log(JSON.stringify({ event, ...data, at: new Date().toISOString() }));
}

// Defence in depth only (rate limits are the real control): stop other websites from making
// visitors' browsers call our endpoints. Requests without an Origin header (non-browser clients)
// are not blocked here; they're limited like everyone else.
export function originAllowed(origin) {
  if (!origin) return true;
  const extra = (process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
  if (extra.includes(origin)) return true;
  try {
    const { protocol, hostname } = new URL(origin);
    if (hostname === 'getunmet.com' || hostname === 'www.getunmet.com') return protocol === 'https:';
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    return protocol === 'https:' && hostname.endsWith('.vercel.app') && hostname.startsWith('unmet');
  } catch {
    return false;
  }
}

// Only for tests.
export function _resetMemoryForTests() {
  memory.clear();
}
