// Serverless function (Vercel) for the lightweight cross-device "sync code"
// feature. No accounts, no passwords -- a sync code is just a high-entropy
// random string that acts as the key for one JSON blob (the full local
// export produced by src/db.js exportAll()).
//
// Storage: Upstash Redis, connected via Vercel's Storage/Marketplace tab.
// That connection auto-injects UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN as environment variables -- nothing else to
// configure here. Uses Upstash's plain REST API (a POST with a JSON
// command array), so no extra npm package is needed.
//
// This is deliberately NOT real-time or automatic: the client calls this
// with action "push" to upload its current data under a code, or "pull"
// to fetch the data stored under a code. Anyone who has the code can read
// or overwrite that data -- treat it like a shared secret, not a password.

const CODE_PATTERN = /^[A-Z0-9]{6,12}$/;
const SIX_MONTHS_SECONDS = 60 * 60 * 24 * 180;

async function redisCommand(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error('Sync storage is not configured on this server.');
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Redis request failed: ${detail}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { action, code, data } = req.body || {};
  if (typeof code !== 'string' || !CODE_PATTERN.test(code)) {
    res.status(400).json({ error: 'Invalid sync code.' });
    return;
  }

  const key = `unmet:sync:${code}`;

  try {
    if (action === 'push') {
      if (!data || typeof data !== 'object') {
        res.status(400).json({ error: 'Missing data to sync.' });
        return;
      }
      const payload = JSON.stringify(data);
      if (payload.length > 2_000_000) {
        res.status(413).json({ error: 'Your data is too large to sync.' });
        return;
      }
      await redisCommand(['SET', key, payload, 'EX', String(SIX_MONTHS_SECONDS)]);
      res.status(200).json({ ok: true });
      return;
    }

    if (action === 'pull') {
      const result = await redisCommand(['GET', key]);
      if (!result.result) {
        res.status(404).json({ error: 'No data found for that sync code.' });
        return;
      }
      res.status(200).json({ data: JSON.parse(result.result) });
      return;
    }

    res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    res.status(500).json({ error: 'Unexpected server error', detail: String(err) });
  }
}
