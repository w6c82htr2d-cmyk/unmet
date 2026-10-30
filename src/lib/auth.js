// Email sign-in with a 6-digit code (Supabase Auth, passwordless OTP).
//
// - The Supabase library is loaded only when accounts are configured and actually needed, so guest
//   use stays as light as before.
// - "Create an account" and "Sign in" use the same request (shouldCreateUser: true): the response
//   never reveals whether an email already has an account, and entering the code proves the
//   address, which is the email verification.
// - Codes, tokens and email contents are never logged.
// - Sessions persist in this browser (key 'unmet_auth') and refresh automatically.
import { supabaseConfig } from './supabaseConfig.js';

export const RESEND_COOLDOWN_SECONDS = 60; // matches Supabase's minimum interval between code emails
export const MAX_CODE_ATTEMPTS = 5;        // wrong codes allowed before a new code is required
const SESSION_KEY = 'unmet_auth';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

let clientPromise = null;
let currentUser = null;
const listeners = new Set();

export function authAvailable() {
  return supabaseConfig.enabled;
}

async function client() {
  if (!supabaseConfig.enabled) throw authError('unavailable');
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) => {
      const c = createClient(supabaseConfig.url, supabaseConfig.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: SESSION_KEY },
      });
      c.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
      return c;
    });
  }
  return clientPromise;
}

function setUser(user) {
  const before = currentUser?.id;
  currentUser = user ? { id: user.id, email: user.email } : null;
  if (before !== currentUser?.id) listeners.forEach((fn) => fn(currentUser));
}

export function getCurrentUser() {
  return currentUser;
}

export function onUserChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// At start-up: restore a saved session (only loads the library if one exists).
export async function initAuth() {
  if (!supabaseConfig.enabled) return null;
  if (!hasStoredSession()) return null;
  try {
    const { data } = await (await client()).auth.getSession();
    setUser(data.session?.user ?? null);
  } catch {
    // Offline or unreachable: the saved session is kept and checked again next time.
  }
  return currentUser;
}

function hasStoredSession() {
  try {
    return localStorage.getItem(SESSION_KEY) !== null;
  } catch {
    return false;
  }
}

export function normalizeEmail(input) {
  return String(input || '').trim().toLowerCase();
}

export function isValidEmail(email) {
  return email.length <= 254 && EMAIL_RE.test(email);
}

// Accepts "123 456", "123-456" and pasted text; returns just the digits.
export function normalizeCode(input) {
  return String(input || '').replace(/\D/g, '').slice(0, 6);
}

function authError(kind, retryAfter) {
  const e = new Error(kind);
  e.kind = kind;
  if (retryAfter) e.retryAfter = retryAfter;
  return e;
}

// Supabase/network errors → a small set of kinds the screen has friendly text for.
export function classifyAuthError(err, step) {
  if (err?.kind) return err.kind;
  const status = err?.status;
  const code = err?.code || '';
  if (err?.name === 'AuthRetryableFetchError' || status === 0 || err instanceof TypeError) return 'network';
  if (status === 429 || code.startsWith('over_')) return 'rate_limited';
  if (code === 'email_address_invalid' || (code === 'validation_failed' && step === 'send')) return 'email_invalid';
  if (code === 'signup_disabled' || code === 'otp_disabled') return 'signup_disabled';
  if (step === 'verify' && (code === 'otp_expired' || status === 403 || status === 400)) return 'code_invalid';
  return 'unknown';
}

export async function sendCode(email) {
  if (!isValidEmail(email)) throw authError('email_invalid');
  const c = await client();
  const { error } = await c.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw authError(classifyAuthError(error, 'send'));
}

export async function verifyCode(email, code) {
  if (!/^\d{6}$/.test(code)) throw authError('code_format');
  const c = await client();
  const { data, error } = await c.auth.verifyOtp({ email, token: code, type: 'email' });
  if (error) throw authError(classifyAuthError(error, 'verify'));
  setUser(data.user ?? data.session?.user ?? null);
  return currentUser;
}

// everywhere=false: this device only. everywhere=true: ends the session on every device.
export async function signOut({ everywhere = false } = {}) {
  if (!supabaseConfig.enabled) return;
  const c = await client();
  const { error } = await c.auth.signOut({ scope: everywhere ? 'global' : 'local' });
  if (error && everywhere) throw authError(classifyAuthError(error, 'signout'));
  if (error) {
    // Couldn't reach the server (e.g. offline). Signing out of this device must still work: stop the
    // client refreshing, forget the saved session and start from a fresh client next time.
    c.auth.stopAutoRefresh?.();
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // Nothing more we can do; the session can't be restored without storage anyway.
    }
    clientPromise = null;
  }
  setUser(null);
}

// Only for tests.
export function _resetForTests() {
  clientPromise = null;
  currentUser = null;
  listeners.clear();
}
