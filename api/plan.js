// Serverless function (Vercel) that turns free-form journal text into a
// structured plan using the Anthropic Messages API. Called by
// src/lib/aiPlan.js (USE_STUB = false), which only cares about the
// { goals: [...] } shape below.
//
// The key comes from the ANTHROPIC_API_KEY environment variable on the host
// and never reaches the browser.
//
// Model choice: uses claude-haiku-4-5, Anthropic's cheapest current model
// (~5x cheaper than the flagship Opus tier) — plenty capable for this small
// extraction task. Swap the model string below to "claude-opus-5" if you
// ever want higher-quality plans at a higher per-use cost.
//
// Abuse protection (api/_lib/guard.js): per-client and global rate limits in
// Upstash Redis, strict input validation, an upstream timeout, generic error
// messages (details go to the function logs only), and daily usage counters.
// None of it changes the model call or the shape of a successful response.

import { checkRateLimits, clientIp, hashClient, recordUsage, logEvent } from './_lib/guard.js';

// Limits: generous for real use (a plan takes a minute of writing), tight enough that a script
// can't run up the bill. PLAN_DAILY_LIMIT caps all users together per UTC day.
const MAX_TEXT_CHARS = 20000; // anything beyond 4,000 is ignored by the model call anyway
const UPSTREAM_TIMEOUT_MS = 25000;
function planLimits(clientId) {
  return [
    { name: 'burst', key: `unmet:rl:plan:c:${clientId}:10m`, limit: 10, windowSec: 600 },
    { name: 'daily', key: `unmet:rl:plan:c:${clientId}:1d`, limit: 40, windowSec: 86400 },
    { name: 'global', key: 'unmet:rl:plan:all:1d', limit: Number(process.env.PLAN_DAILY_LIMIT) || 2000, windowSec: 86400 },
  ];
}

// Defence in depth only (rate limits are the real control): stop other websites from making
// visitors' browsers call this endpoint. Requests without an Origin header (non-browser clients)
// are not blocked here, they're limited like everyone else.
function originAllowed(origin) {
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

function sendError(res, status, code, message) {
  res.status(status).json({ error: message, code });
}

const SYSTEM_PROMPT = `You turn a person's free-form journal entry about things they want to achieve into a structured plan.

Read the journal text and extract each distinct goal or intention mentioned. For each one, decide:
- importance: "high", "medium", or "low"
- urgency: "high" or "low" (does it have a deadline or time pressure?)
- firstStep: the most useful category of first action —
  - "stack": a small recurring habit that could be attached after something the person already does daily
  - "calendar": something that needs dedicated blocks of time scheduled
  - "task": a goal vague enough that it should be broken into concrete sub-tasks

Respond with ONLY a valid JSON object in exactly this shape, no prose, no markdown code fences:
{"goals":[{"id":"g0","text":"short goal label","importance":"high","urgency":"low","firstStep":{"type":"stack","label":"short suggested first action"}}]}`;

export default async function handler(req, res) {
  const started = Date.now();
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!originAllowed(req.headers?.origin)) {
    logEvent('plan_rejected', { reason: 'origin' });
    sendError(res, 403, 'forbidden', 'Requests from this site are not allowed.');
    return;
  }

  if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) {
    sendError(res, 415, 'unsupported_media_type', 'Send the journal text as JSON.');
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logEvent('plan_error', { reason: 'missing_api_key' });
    sendError(res, 503, 'unavailable', 'AI planning is not available right now.');
    return;
  }

  const body = req.body;
  const text = body && typeof body === 'object' && !Array.isArray(body) ? body.text : undefined;
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'Missing journal text.', code: 'invalid_input' });
    return;
  }
  if (text.length > MAX_TEXT_CHARS) {
    sendError(res, 413, 'too_large', 'That entry is too long to plan in one go.');
    return;
  }

  // Validation happens before counting, so malformed requests don't use up anyone's allowance.
  const rate = await checkRateLimits(planLimits(hashClient(clientIp(req))));
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfter));
    logEvent('plan_rate_limited', { limit: rate.limit, store: rate.store });
    await recordUsage('plan', { rate_limited: 1 });
    sendError(res, 429, 'rate_limited', 'Too many plan requests. Please try again later.');
    return;
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: text.slice(0, 4000) }],
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Upstream details stay in the logs (status only — the body can echo request content).
      logEvent('plan_error', { reason: 'upstream_status', status: response.status, ms: Date.now() - started });
      await recordUsage('plan', { upstream_errors: 1 });
      sendError(res, 502, 'upstream_error', 'AI planning failed. Please try again.');
      return;
    }

    const data = await response.json();
    const usage = data.usage || {};
    await recordUsage('plan', { calls: 1, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens });

    const textBlock = (data.content || []).find((b) => b.type === 'text');
    if (!textBlock) {
      logEvent('plan_error', { reason: 'no_text_block', stop: data.stop_reason });
      sendError(res, 502, 'bad_model_output', 'AI planning failed. Please try again.');
      return;
    }

    const cleaned = textBlock.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      logEvent('plan_error', { reason: 'invalid_json', stop: data.stop_reason, chars: cleaned.length });
      await recordUsage('plan', { bad_output: 1 });
      sendError(res, 502, 'bad_model_output', 'AI planning failed. Please try again.');
      return;
    }

    logEvent('plan_ok', { ms: Date.now() - started, in: usage.input_tokens, out: usage.output_tokens, store: rate.store });
    res.status(200).json(parsed);
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    logEvent('plan_error', { reason: timedOut ? 'timeout' : 'exception', name: err?.name });
    await recordUsage('plan', { [timedOut ? 'timeouts' : 'exceptions']: 1 });
    sendError(res, timedOut ? 504 : 500, timedOut ? 'timeout' : 'server_error', 'AI planning failed. Please try again.');
  }
}
