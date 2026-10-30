// Serverless function (Vercel) for the lightweight cross-device "sync code"
// feature. No accounts, no passwords -- a sync code is a random string that
// acts as the key for one JSON blob (the full local export produced by
// src/db.js exportAll()).
//
// Storage: Upstash Redis, connected via Vercel's Storage/Marketplace tab.
// That connection auto-injects UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN as environment variables. Uses Upstash's plain
// REST API, so no extra npm package is needed.
//
// Anyone who has the code can read, overwrite or delete that data -- treat it
// like a shared secret. Protections (api/_lib/guard.js and below):
//  - New codes must be 12 characters (~60 bits); existing shorter codes keep working.
//  - Per-client rate limits, with a much tighter limit on pulls of codes that
//    don't exist, so codes can't be guessed by brute force.
//  - Revision check: a push based on stale data is refused instead of silently
//    overwriting newer data from another device (older clients without a
//    revision are still accepted).
//  - Data expires 180 days after it was last pushed or pulled.
//  - Generic error messages; logs carry metadata only.

import { redisPipeline, checkRateLimits, isOverLimit, clientIp, hashClient, logEvent, originAllowed } from './_lib/guard.js';

const CODE_PATTERN = /^[A-Z0-9]{6,12}$/;
const NEW_CODE_LENGTH = 12;
const TTL_SECONDS = 60 * 60 * 24 * 180;
const MAX_PAYLOAD_CHARS = 2_000_000;

function limitsFor(action, clientId) {
  const c = `unmet:rl:sync:c:${clientId}`;
  return {
    pull: [{ name: 'pull', key: `${c}:pull`, limit: 60, windowSec: 3600 }],
    push: [{ name: 'push', key: `${c}:push`, limit: 60, windowSec: 3600 }],
    delete: [{ name: 'delete', key: `${c}:delete`, limit: 10, windowSec: 3600 }],
    // Counted only when a pull finds nothing, i.e. a wrong (or guessed) code.
    miss: [{ name: 'miss', key: `${c}:miss`, limit: 10, windowSec: 3600 }],
    create: [
      { name: 'create', key: `${c}:create`, limit: 10, windowSec: 86400 },
      { name: 'create-all', key: 'unmet:rl:sync:all:create', limit: Number(process.env.SYNC_DAILY_NEW_CODES) || 1000, windowSec: 86400 },
    ],
  }[action];
}

function sendError(res, status, code, message) {
  res.status(status).json({ error: message, code });
}

function expiresAt(now = Date.now()) {
  return new Date(now + TTL_SECONDS * 1000).toISOString();
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!originAllowed(req.headers?.origin)) {
    sendError(res, 403, 'forbidden', 'Requests from this site are not allowed.');
    return;
  }
  if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) {
    sendError(res, 415, 'unsupported_media_type', 'Send JSON.');
    return;
  }

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const { action, code, data, baseRev } = body;
  if (!['push', 'pull', 'delete'].includes(action)) {
    sendError(res, 400, 'invalid_action', 'Unknown action.');
    return;
  }
  if (typeof code !== 'string' || !CODE_PATTERN.test(code)) {
    sendError(res, 400, 'invalid_code', 'Invalid sync code.');
    return;
  }

  const clientId = hashClient(clientIp(req));
  // A client that has used up its wrong-code allowance can't pull at all until the hour is over.
  if (action === 'pull' && (await isOverLimit(limitsFor('miss', clientId)[0]))) {
    res.setHeader('Retry-After', '3600');
    logEvent('sync_rate_limited', { action, limit: 'miss' });
    sendError(res, 429, 'rate_limited', 'Too many sync requests. Please try again later.');
    return;
  }
  const rate = await checkRateLimits(limitsFor(action, clientId));
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfter));
    logEvent('sync_rate_limited', { action, limit: rate.limit, store: rate.store });
    sendError(res, 429, 'rate_limited', 'Too many sync requests. Please try again later.');
    return;
  }

  const key = `unmet:sync:${code}`;
  const metaKey = `unmet:syncmeta:${code}`;

  try {
    if (action === 'pull') {
      const [blob, rev] = await redisPipeline([['GET', key], ['GET', metaKey]]);
      if (!blob) {
        await checkRateLimits(limitsFor('miss', clientId)); // count the miss
        logEvent('sync_pull_miss', {});
        sendError(res, 404, 'not_found', 'No data found for that sync code.');
        return;
      }
      // Pulling counts as use: keep the data for another 180 days.
      await redisPipeline([['EXPIRE', key, String(TTL_SECONDS)], ['EXPIRE', metaKey, String(TTL_SECONDS)]]);
      res.status(200).json({ data: JSON.parse(blob), rev: Number(rev) || 0, expiresAt: expiresAt() });
      return;
    }

    if (action === 'delete') {
      await redisPipeline([['DEL', key], ['DEL', metaKey]]);
      logEvent('sync_deleted', {});
      res.status(200).json({ ok: true });
      return;
    }

    // push
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      sendError(res, 400, 'invalid_data', 'Missing data to sync.');
      return;
    }
    const payload = JSON.stringify(data);
    if (payload.length > MAX_PAYLOAD_CHARS) {
      sendError(res, 413, 'too_large', 'Your data is too large to sync.');
      return;
    }
    const [exists, currentRevRaw] = await redisPipeline([['EXISTS', key], ['GET', metaKey]]);
    const currentRev = Number(currentRevRaw) || 0;
    if (!Number(exists)) {
      if (code.length < NEW_CODE_LENGTH) {
        sendError(res, 400, 'code_too_short', 'New sync codes must be 12 characters.');
        return;
      }
      const created = await checkRateLimits(limitsFor('create', clientId));
      if (!created.allowed) {
        res.setHeader('Retry-After', String(created.retryAfter));
        sendError(res, 429, 'rate_limited', 'Too many new sync codes. Please try again later.');
        return;
      }
    } else if (baseRev !== undefined && Number(baseRev) !== currentRev) {
      // Another device pushed since this one last synced: don't overwrite its newer data.
      res.status(409).json({ error: 'This code has newer data from another device. Load it first, then upload again.', code: 'conflict', rev: currentRev });
      return;
    }
    const nextRev = currentRev + 1;
    await redisPipeline([
      ['SET', key, payload, 'EX', String(TTL_SECONDS)],
      ['SET', metaKey, String(nextRev), 'EX', String(TTL_SECONDS)],
    ]);
    res.status(200).json({ ok: true, rev: nextRev, expiresAt: expiresAt() });
  } catch (err) {
    logEvent('sync_error', { action, reason: err?.message === 'redis-not-configured' ? 'not_configured' : 'store_error' });
    sendError(res, 503, 'unavailable', 'Sync is not available right now. Please try again later.');
  }
}
