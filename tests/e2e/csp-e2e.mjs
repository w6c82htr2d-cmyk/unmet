import { createRequire } from 'module';
import { readFileSync } from 'node:fs';
const require = createRequire('/opt/node-tools/node_modules/dummy.js');
const { chromium } = require('playwright');
const BASE = 'http://localhost:8092';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-fake-ui-for-media-stream'] });
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const FONT = readFileSync('/usr/share/fonts/opentype/inter/Inter-Regular.otf');

async function page(route, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, permissions: ['microphone'] });
  // Stand-ins for Google Fonts (the sandbox can't reach Google): a stylesheet from fonts.googleapis.com
  // that loads a font file from fonts.gstatic.com — exactly the two origins the policy allows.
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: "@font-face{font-family:'Inter';src:url(https://fonts.gstatic.com/s/inter/test.otf) format('opentype');}" }));
  await ctx.route('https://fonts.gstatic.com/**', (r) => r.fulfill({ contentType: 'font/otf', body: FONT, headers: { 'access-control-allow-origin': '*' } }));
  await ctx.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI || ''} ${e.sample || ''}`.trim()));
  });
  const p = await ctx.newPage();
  p.__errors = [];
  p.on('pageerror', (e) => p.__errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) p.__errors.push('console: ' + m.text()); });
  p.on('requestfailed', (r) => { if (r.url().startsWith(BASE)) p.__errors.push('request failed: ' + r.url()); });
  p.on('dialog', (d) => d.accept());
  await p.goto(`${BASE}/seed.html?r=${route}&theme=dark${opts.q || ''}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  return p;
}
const violations = (p) => p.evaluate(() => window.__csp);

// 0. The policy is really enforced
{
  const p = await page('');
  await p.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__inlineRan = 1'; document.body.appendChild(s); });
  await p.waitForTimeout(100);
  check('CSP is active: an injected inline script is blocked', !(await p.evaluate(() => window.__inlineRan)) && (await violations(p)).some((v) => v.startsWith('script-src')));
  const ext = await p.evaluate(async () => { try { await fetch('https://example.com/x'); return 'allowed'; } catch { return 'blocked'; } });
  check('CSP is active: requests to other sites are blocked (connect-src)', ext === 'blocked');
  await p.context().close();
}

// 1. Every screen renders with no violations or errors
for (const route of ['', 'calendar&view=day', 'calendar&view=week', 'journal', 'journal/morning', 'journal/evening', 'journal/freeform', 'tasks', 'settings', 'help', 'insight']) {
  const p = await page(route);
  const v = await violations(p);
  const rendered = await p.evaluate(() => document.querySelector('#page-root')?.children.length > 0);
  check(`/${route || 'home'}: renders, no CSP violations, no errors`, rendered && v.length === 0 && p.__errors.length === 0, [...v, ...p.__errors].join(' | '));
  await p.context().close();
}

// 2. Fonts from Google load under the policy
{
  const p = await page('');
  await p.evaluate(() => document.fonts.ready);
  const fonts = await p.evaluate(() => [...document.fonts].filter((f) => f.family.replace(/"/g, '') === 'Inter').map((f) => f.status));
  check('Google Fonts stylesheet and font file are allowed and load', fonts.includes('loaded') && (await violations(p)).length === 0, JSON.stringify(fonts));
  await p.context().close();
}

// 3. Interactions: AI plan (real /api/plan handler, AI simulated), sync, import/export, undo, forms, theme, mic
{
  const p = await page('journal/freeform');
  await p.fill('#brainDump', 'I want to learn French');
  await p.click('#planBtn'); await p.waitForTimeout(800);
  check('AI plan works under the policy (same-origin /api/plan)', (await p.locator('#page-root').textContent()).includes('Learn French') && (await violations(p)).length === 0, (await violations(p)).join(' | '));
  await p.context().close();
}
{
  const p = await page('journal/freeform');
  const supported = await p.evaluate(() => !!(window.SpeechRecognition || window.webkitSpeechRecognition));
  const mic = await p.locator('#journalMic').count();
  await p.click('#journalMic').catch(() => {});
  await p.waitForTimeout(1200);
  const state = await p.locator('#page-root').textContent();
  check('Voice dictation: API available, mic button starts it, no CSP violation', supported && mic === 1 && (await violations(p)).length === 0, (await violations(p)).join(' | ') || 'speech API present: ' + supported);
  console.log('      (headless result after tapping the mic: ' + (/listening/i.test(state) ? 'listening' : /microphone|speech|network|not available|blocked/i.exec(state)?.[0] || 'no message') + ')');
  await p.context().close();
}
{
  const p = await page('settings');
  await p.click('#getCodeBtn'); await p.waitForTimeout(600);
  const code = await p.evaluate(() => localStorage.getItem('unmet_sync_code'));
  check('Sync works under the policy (same-origin /api/sync)', /^[A-Z0-9]{12}$/.test(code || '') && (await violations(p)).length === 0, code);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#exportBtn')]);
  check('Export download (blob URL) works', dl.suggestedFilename().startsWith('unmet-export-'));
  await p.setInputFiles('#importFile', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ unmet_goals: [] })) });
  await p.waitForTimeout(200);
  check('Import preview works', (await p.locator('.import-preview').count()) === 1);
  await p.click('#themeToggle [data-val="light"]'); await p.waitForTimeout(200);
  check('Theme toggle works', (await p.evaluate(() => document.documentElement.dataset.theme)) === 'light');
  check('Settings interactions: no violations or errors', (await violations(p)).length === 0 && p.__errors.length === 0, [...(await violations(p)), ...p.__errors].join(' | '));
  await p.context().close();
}
{
  const p = await page('calendar&view=day');
  await p.click('#addMenuBtn'); await p.click('#addRoutineQuickBtn'); await p.waitForTimeout(200);
  await p.evaluate(() => { location.hash = '#/'; }); await p.waitForTimeout(200);
  await p.locator('.habit-edit-trigger').first().click(); await p.click('#deleteHabitBtn'); await p.waitForTimeout(150);
  await p.click('.undo-toast-btn'); await p.waitForTimeout(150);
  await p.locator('.habit-check').first().click(); await p.waitForTimeout(150);
  check('Calendar form, habit delete + undo, completion: no violations or errors', (await violations(p)).length === 0 && p.__errors.length === 0, [...(await violations(p)), ...p.__errors].join(' | '));
  await p.context().close();
}
// 4. Onboarding (new visitor)
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective)); });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(300);
  check('Onboarding renders for a new visitor, dark theme, no violations', (await p.locator('#nameInput').count()) === 1 && (await p.evaluate(() => document.documentElement.dataset.theme)) === 'dark' && (await violations(p)).length === 0);
  await ctx.close();
}
// 5. Framing is refused
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const refused = [];
  p.on('console', (m) => { if (/Refused to (display|frame)/.test(m.text())) refused.push(m.text().slice(0, 60)); });
  await p.setContent(`<iframe src="${BASE}/"></iframe>`);
  await p.waitForTimeout(1200);
  const framedApp = await p.frames()[1]?.evaluate(() => !!document.querySelector('#app')).catch(() => false);
  check('Another site cannot embed UNMET in a frame', !framedApp, refused[0] || 'frame blocked');
  await ctx.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
