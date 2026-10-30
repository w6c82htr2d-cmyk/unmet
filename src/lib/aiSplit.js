// Task Splitter → /api/split. Any failure (offline, rate limit, server not configured, local dev
// without the API) is reported to the caller, which falls back to the local starter templates.
export const CHALLENGES = ['starting', 'focus', 'time', 'overwhelm', 'energy', 'remembering'];

export async function splitWithAI({ goal, challenges = [], note = '', lang = 'en' }) {
  let res;
  try {
    res = await fetch('/api/split', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal, challenges, note, lang }),
    });
  } catch {
    const err = new Error('offline');
    err.status = 0;
    throw err;
  }
  if (!res.ok) {
    const err = new Error('AI task splitting failed');
    err.status = res.status;
    throw err;
  }
  const data = await res.json().catch(() => null);
  if (!data || !Array.isArray(data.steps) || data.steps.length < 2) {
    const err = new Error('bad response');
    err.status = 502;
    throw err;
  }
  return data.steps;
}

// Personalization choices, remembered on this device only.
const PREFS_KEY = 'unmet_split_prefs';

export function getSplitPrefs() {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    return {
      challenges: Array.isArray(v?.challenges) ? v.challenges.filter((c) => CHALLENGES.includes(c)) : [],
      note: typeof v?.note === 'string' ? v.note.slice(0, 300) : '',
    };
  } catch {
    return { challenges: [], note: '' };
  }
}

export function saveSplitPrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ challenges: prefs.challenges, note: prefs.note.slice(0, 300) }));
  } catch {
    // Not remembered: harmless.
  }
}
