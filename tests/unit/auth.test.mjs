import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, checkPublicKey } from '../../src/lib/supabaseConfig.js';
import { normalizeEmail, isValidEmail, normalizeCode, classifyAuthError, authAvailable } from '../../src/lib/auth.js';

const jwt = (payload) => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');
const URL = 'https://abcdefghijklmnop.supabase.co';

test('accounts are off unless both URL and public key are configured', () => {
  assert.equal(readConfig({}).enabled, false);
  assert.equal(readConfig({ VITE_SUPABASE_URL: URL }).enabled, false);
  assert.equal(authAvailable(), false); // no env in tests → guest-only build
  const ok = readConfig({ VITE_SUPABASE_URL: URL + '/', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc123' });
  assert.deepEqual(ok, { enabled: true, url: URL, key: 'sb_publishable_abc123' });
});

test('secret keys are refused, never used in the browser', () => {
  assert.equal(checkPublicKey('sb_secret_abc'), 'secret');
  assert.equal(checkPublicKey(jwt({ role: 'service_role' })), 'secret');
  assert.equal(checkPublicKey(jwt({ role: 'anon' })), 'ok');
  assert.equal(checkPublicKey('sb_publishable_x'), 'ok');
  assert.equal(checkPublicKey('random'), 'unknown');
  const r = readConfig({ VITE_SUPABASE_URL: URL, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_123' });
  assert.deepEqual(r, { enabled: false, reason: 'secret_key_refused' });
});

test('only real Supabase project URLs over HTTPS are accepted', () => {
  for (const bad of ['http://abc.supabase.co', 'https://evil.example.com', 'https://abc.supabase.co.evil.com', 'https://abc.supabase.co/path']) {
    assert.equal(readConfig({ VITE_SUPABASE_URL: bad, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }).enabled, false, bad);
  }
});

test('email and code input handling', () => {
  assert.equal(normalizeEmail('  Layla@Example.COM '), 'layla@example.com');
  assert.ok(isValidEmail('layla@example.com'));
  for (const bad of ['', 'layla', 'layla@', '@example.com', 'a b@example.com', 'layla@example', `${'x'.repeat(250)}@example.com`]) assert.ok(!isValidEmail(bad), bad);
  assert.equal(normalizeCode(' 123 456 '), '123456');
  assert.equal(normalizeCode('123-4567'), '123456');
  assert.equal(normalizeCode('abc'), '');
});

test('Supabase errors map to friendly kinds', () => {
  assert.equal(classifyAuthError({ status: 429, code: 'over_email_send_rate_limit' }, 'send'), 'rate_limited');
  assert.equal(classifyAuthError({ status: 403, code: 'otp_expired' }, 'verify'), 'code_invalid');
  assert.equal(classifyAuthError({ status: 400, code: 'email_address_invalid' }, 'send'), 'email_invalid');
  assert.equal(classifyAuthError({ name: 'AuthRetryableFetchError', status: 0 }, 'send'), 'network');
  assert.equal(classifyAuthError({ status: 422, code: 'signup_disabled' }, 'send'), 'signup_disabled');
  assert.equal(classifyAuthError({ status: 500 }, 'send'), 'unknown');
});
