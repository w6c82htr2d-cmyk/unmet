import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../helpers.mjs';

installLocalStorage();
globalThis.document = { documentElement: { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } } };
let n = 0;
const load = async () => (await import(`../../src/theme.js?v=${n++}`)).getTheme();

test('brand-new visitor gets dark, and keeps it after onboarding', async () => {
  localStorage.clear();
  assert.equal(await load(), 'dark');
  localStorage.setItem('unmet_profile', JSON.stringify({ firstName: 'New' }));
  assert.equal(await load(), 'dark');
});

test('existing user with no saved choice keeps the light theme they had', async () => {
  localStorage.clear();
  localStorage.setItem('unmet_profile', JSON.stringify({ firstName: 'Old' }));
  assert.equal(await load(), 'light');
  assert.equal(localStorage.getItem('unmet_theme'), 'light');
});

test('an explicit choice always wins', async () => {
  for (const choice of ['light', 'dark']) {
    localStorage.clear();
    localStorage.setItem('unmet_theme', choice);
    assert.equal(await load(), choice);
    localStorage.setItem('unmet_profile', '{}');
    assert.equal(await load(), choice);
  }
});
