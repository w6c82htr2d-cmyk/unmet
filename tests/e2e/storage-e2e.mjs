import { createRequire } from 'module';
const require = createRequire('/opt/node-tools/node_modules/dummy.js');
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
let pass = 0, fail = 0; const errors = [];
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const fill = (p) => p.evaluate(() => { let i = 0; for (const size of [262144, 16384, 1024, 64, 4, 1]) { const c = 'x'.repeat(size); try { for (;; i++) localStorage.setItem('filler_' + i, c); } catch { } } });
const unfill = (p) => p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('filler_')).forEach((k) => localStorage.removeItem(k)));
const warning = (p) => p.locator('.storage-warning').textContent().catch(() => '');
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => errors.push(e.message));
let planCalls = 0;
await p.route('**/api/plan', (r) => { planCalls++; r.fulfill({ status: 200, contentType: 'application/json', body: '{"goals":[]}' }); });
await p.goto('http://localhost:8090/seed.html?r=&theme=dark', { waitUntil: 'networkidle' });
await p.waitForTimeout(300);

// 1. Habit completion
await fill(p);
const id = await p.$eval('.habit-check:not(.done)', (b) => b.dataset.id);
const before = await p.evaluate(() => localStorage.getItem('unmet_habits'));
await p.click(`.habit-check[data-id="${id}"]`); await p.waitForTimeout(200);
check('Habit: warning shown', (await warning(p)).includes("wasn't saved"));
check('Habit: not shown as completed', !(await p.$eval(`.habit-check[data-id="${id}"]`, (b) => b.classList.contains('done'))));
check('Habit: stored data unchanged', (await p.evaluate(() => localStorage.getItem('unmet_habits'))) === before);
await p.screenshot({ path: '/tmp/unmet-storage-warning.png' });
await p.click('.storage-warning .btn.ghost'); await p.waitForTimeout(100);
check('Warning can be dismissed', (await p.locator('.storage-warning').count()) === 0);

// 2. Morning journal
await p.evaluate(() => { location.hash = '#/journal/morning'; }); await p.waitForTimeout(250);
await p.fill('.priority-text[data-i="0"]', 'Finish lab report');
await p.click('#saveBtn'); await p.waitForTimeout(200);
check('Morning journal: warning shown and still on the page', (await warning(p)).includes("wasn't saved") && (await p.evaluate(() => location.hash)) === '#/journal/morning');
check('Morning journal: typed text kept', (await p.inputValue('.priority-text[data-i="0"]')) === 'Finish lab report');
check('Morning journal: nothing stored', !((await p.evaluate(() => localStorage.getItem('unmet_morning') || '')).includes('Finish lab report')));
await p.click('.storage-warning .btn.ghost');

// 3. Free-form journal + AI plan
await p.evaluate(() => { location.hash = '#/journal/freeform'; }); await p.waitForTimeout(250);
await p.fill('#brainDump', 'I want to learn French');
await p.click('#planBtn'); await p.waitForTimeout(300);
const ffText = await p.locator('#page-root').textContent();
check('Free-form: says "not saved", not an AI error', ffText.includes('Not saved') && !ffText.includes('temporarily unavailable'));
check('Free-form: AI not called when the entry could not be saved', planCalls === 0);
check('Free-form: text still in the box', (await p.inputValue('#brainDump')) === 'I want to learn French');
await p.click('.storage-warning .btn.ghost');

// 4. Calendar routine
await p.evaluate(() => { location.hash = '#/calendar'; }); await p.waitForTimeout(250);
const evBefore = await p.evaluate(() => localStorage.getItem('unmet_events'));
await p.click('#addMenuBtn'); await p.click('#addRoutineQuickBtn'); await p.waitForTimeout(200);
await p.fill('#evTitle', 'TEST Lab'); await p.click('#eventForm .weekday-chip[data-day="1"]'); await p.click('#eventForm .weekday-chip[data-day="3"]');
await p.fill('#evStart', '10:00'); await p.fill('#evEnd', '11:30');
await p.click('#eventForm button[type="submit"]'); await p.waitForTimeout(200);
check('Routine: warning shown, nothing half-saved, form still open', (await warning(p)).includes("wasn't saved") && (await p.evaluate(() => localStorage.getItem('unmet_events'))) === evBefore && (await p.locator('#eventForm').count()) === 1);
await p.click('.storage-warning .btn.ghost');

// 5. After freeing space, saving works again
await unfill(p);
await p.evaluate(() => { location.hash = '#/'; }); await p.waitForTimeout(250);
await p.click(`.habit-check[data-id="${id}"]`); await p.waitForTimeout(200);
check('After freeing space: completion saves and shows', await p.$eval(`.habit-check[data-id="${id}"]`, (b) => b.classList.contains('done')) && (await p.locator('.storage-warning').count()) === 0);
check('No uncaught page errors', errors.length === 0, JSON.stringify(errors));

// 6. Storage blocked from the start (e.g. private mode)
const blocked = await browser.newContext({ viewport: { width: 390, height: 844 } });
const q = await blocked.newPage();
await q.goto('http://localhost:8090/favicon.svg');
await q.addInitScript(() => { Storage.prototype.setItem = function () { const e = new Error('blocked'); e.name = 'SecurityError'; throw e; }; });
await q.goto('http://localhost:8090/index.html', { waitUntil: 'networkidle' }); await q.waitForTimeout(300);
check('Blocked storage: warning shown on load', (await warning(q)).includes("isn't saving"));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
