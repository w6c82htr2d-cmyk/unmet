// Supabase connection settings, read at build time from Vite environment variables:
//   VITE_SUPABASE_URL              e.g. https://abcdefghijklmnop.supabase.co
//   VITE_SUPABASE_PUBLISHABLE_KEY  the project's publishable key (sb_publishable_…) or legacy anon key
// Both are public by design: they only allow what Row Level Security permits. When they're missing
// (for example in production until accounts launch), accounts are simply switched off and UNMET
// works exactly as before, in guest mode.
//
// A secret key must never reach the browser. checkPublicKey() refuses anything that looks like one
// (sb_secret_… keys, or legacy JWT keys whose role is service_role), so a misconfigured build can't
// ship it into the app.

const URL_RE = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/;

export function checkPublicKey(key) {
  if (typeof key !== 'string' || !key) return 'missing';
  if (key.startsWith('sb_secret_')) return 'secret';
  if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(key)) {
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role === 'service_role') return 'secret';
      if (payload.role !== 'anon') return 'unknown';
    } catch {
      return 'unknown';
    }
    return 'ok';
  }
  return key.startsWith('sb_publishable_') ? 'ok' : 'unknown';
}

export function readConfig(env) {
  const url = String(env?.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(env?.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!url && !key) return { enabled: false, reason: 'not_configured' };
  if (!URL_RE.test(url)) return { enabled: false, reason: 'bad_url' };
  const keyState = checkPublicKey(key);
  if (keyState !== 'ok') return { enabled: false, reason: keyState === 'secret' ? 'secret_key_refused' : 'bad_key' };
  return { enabled: true, url, key };
}

export const supabaseConfig = readConfig(typeof import.meta !== 'undefined' ? import.meta.env : {});

if (!supabaseConfig.enabled && supabaseConfig.reason !== 'not_configured') {
  // Says why, never what the key was.
  console.warn(`UNMET accounts disabled: ${supabaseConfig.reason}`);
}
