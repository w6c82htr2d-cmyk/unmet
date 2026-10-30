import { createRequire } from 'module';
const require = createRequire('/opt/node-tools/node_modules/dummy.js');
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
let pass = 0, fail = 0; const errors = [];
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

// 1. First paint already has the saved theme / direction, even while the app script is still loading.
for (const [label, setup, expect] of [
  ['existing light user', { unmet_profile: '{"onboarded":true}', unmet_theme: 'light' }, { theme: 'light', dir: 'ltr' }],
  ['legacy user, no saved theme', { unmet_profile: '{"onboarded":true}' }, { theme: 'light', dir: 'ltr' }],
  ['new visitor', {}, { theme: 'dark', dir: 'ltr' }],
  ['Arabic dark user', { unmet_profile: '{"onboarded":true}', unmet_theme: 'dark', unmet_lang: 'ar' }, { theme: 'dark', dir: 'rtl' }],
]) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto('http://localhost:8090/favicon.svg');
  await p.evaluate((s) => { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, setup);
  await p.route('**/assets/*.js', async (r) => { await new Promise((res) => setTimeout(res, 1500)); r.continue(); });
  await p.goto('http://localhost:8090/index.html', { waitUntil: 'commit' });
  await p.waitForSelector('body');
  await p.waitForTimeout(300); // app module still delayed
  const first = await p.evaluate(() => ({ theme: document.documentElement.dataset.theme, dir: document.documentElement.dir, app: !!document.querySelector('#app *') }));
  check(`First paint (${label}): theme=${expect.theme} dir=${expect.dir} before the app loads`, first.theme === expect.theme && first.dir === expect.dir && !first.app, JSON.stringify(first));
  await ctx.close();
}

// 2. Two tabs
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const a = await ctx.newPage(); const b = await ctx.newPage();
for (const pg of [a, b]) pg.on('pageerror', (e) => errors.push(e.message));
await a.goto('http://localhost:8090/seed.html?r=&theme=dark', { waitUntil: 'networkidle' }); await a.waitForTimeout(300);
await b.goto('http://localhost:8090/index.html#/', { waitUntil: 'networkidle' }); await b.waitForTimeout(300);
const id = await a.$eval('.habit-check:not(.done)', (el) => el.dataset.id);
await a.click(`.habit-check[data-id="${id}"]`); await a.waitForTimeout(300);
check('Tab B shows a completion made in tab A, without reloading', await b.$eval(`.habit-check[data-id="${id}"]`, (el) => el.classList.contains('done')));

// Tab B is typing a new habit: tab A's change must not wipe it
await b.click('#addHabitToggle'); await b.waitForTimeout(150);
await b.fill('#addName', 'Half-typed habit');
await a.click(`.habit-check[data-id="${id}"]`); await a.waitForTimeout(300);
await b.locator('#addName').blur(); await b.waitForTimeout(200);
check('Tab B keeps half-typed text when tab A saves', (await b.inputValue('#addName').catch(() => '')) === 'Half-typed habit');

// Theme change follows across tabs
await a.evaluate(() => { location.hash = '#/settings'; }); await a.waitForTimeout(200);
await a.click('#themeToggle [data-val="light"]'); await a.waitForTimeout(300);
check('Tab B follows a theme change made in tab A', (await b.evaluate(() => document.documentElement.dataset.theme)) === 'light');
check('No page errors', errors.length === 0, JSON.stringify(errors));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
