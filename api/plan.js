// Serverless function (Vercel) that turns free-form journal text into a
// structured plan using the Anthropic Messages API. This is NOT wired up
// yet — src/lib/aiPlan.js has USE_STUB = true, so the client never calls
// this endpoint today.
//
// To activate tomorrow, once you have your Anthropic API key:
//   1. Add ANTHROPIC_API_KEY as an environment variable on your host
//      (Vercel: Project Settings -> Environment Variables).
//   2. Set USE_STUB = false in src/lib/aiPlan.js.
// Nothing else needs to change — the rest of the app already calls
// planFromJournal() and only cares about the { goals: [...] } shape below.
//
// Model choice: uses claude-haiku-4-5, Anthropic's cheapest current model
// (~5x cheaper than the flagship Opus tier) — plenty capable for this small
// extraction task. Swap the model string below to "claude-opus-5" if you
// ever want higher-quality plans at a higher per-use cost.

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
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on this server.' });
    return;
  }

  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'Missing journal text.' });
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
    });

    if (!response.ok) {
      const errBody = await response.text();
      res.status(502).json({ error: 'Anthropic API request failed', detail: errBody });
      return;
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === 'text');
    if (!textBlock) {
      res.status(502).json({ error: 'No text response from model' });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      res.status(502).json({ error: 'Model did not return valid JSON', raw: textBlock.text });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: 'Unexpected server error', detail: String(err) });
  }
}
