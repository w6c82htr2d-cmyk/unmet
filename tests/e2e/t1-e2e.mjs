// Phase 1–2: Home dashboard, completion + undo, 3-question habit form, edit/delete.
import { createRequire } from 'module';
const require = createRequire('/opt/node-tools/node_modules/dummy.js');
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
let pass = 0, fail = 0; const errors = [];
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Riyadh' });
const p = await ctx.newPage();
p.on('pageerror', (e) => errors.push(e.message));
await p.clock.setFixedTime(new Date('2026-10-27T18:00:00+03:00')); // Tuesday: Classes day
await p.goto('http://localhost:8090/seed.html?r=&theme=dark', { waitUntil: 'networkidle' });
await p.waitForTimeout(400);
const habits = () => p.evaluate(() => JSON.parse(localStorage.getItem('unmet_habits')));
const today = '2026-10-27';

// Layout order: greeting → day picker → today's habits → this week
const order = await p.evaluate(() => ['.home-greeting', '.week-strip', '#todayHeading', '.week-card'].map((s) => document.querySelector(s)?.getBoundingClientRect().top ?? -1));
check('Home order: greeting, day picker, today\'s habits, then this week', order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), order.join(','));
check('Only one weekly progress card (old rings and charts removed)', (await p.locator('.week-card').count()) === 1 && (await p.locator('.metric-row-2, .progress-ring').count()) === 0);
check('No emoji in the dashboard', !/🔥/.test(await p.locator('#page-root').textContent()));
const rows = await p.locator('.habit-row').count();
check('Each habit shows a 7-day history', (await p.locator('.habit-days').count()) === rows && (await p.locator('.habit-days .hd').count()) === rows * 7);

// Complete with checkmark + undo
const id = await p.$eval('.habit-check:not(.done)', (b) => b.dataset.id);
await p.click(`.habit-check[data-id="${id}"]`); await p.waitForTimeout(200);
check('Tapping the checkbox completes the habit right away', await p.$eval(`.habit-check[data-id="${id}"]`, (b) => b.classList.contains('done') && b.getAttribute('aria-pressed') === 'true') && (await habits()).find((h) => h.id === id).history[today] === true);
check('Undo is offered after completing', (await p.locator('.undo-toast').textContent()).includes('Done:'));
check('Progress updates immediately', /of|All done/.test(await p.locator('.today-count').textContent()));
await p.click('.undo-toast-btn'); await p.waitForTimeout(200);
check('Undo reverts the completion', !(await habits()).find((h) => h.id === id).history[today] && !(await p.$eval(`.habit-check[data-id="${id}"]`, (b) => b.classList.contains('done'))));

// Future days can't be completed
await p.click('.day-pill[data-date="2026-10-29"]'); await p.waitForTimeout(200);
const futureChecks = await p.$$eval('.habit-check', (bs) => bs.map((b) => b.disabled));
check('Future days: checkboxes are disabled', futureChecks.length > 0 && futureChecks.every(Boolean));
await p.click('.day-pill[data-date="2026-10-27"]'); await p.waitForTimeout(200);

// Form validation
await p.click('#addHabitToggle'); await p.waitForTimeout(250);
check('Add Habit opens the 3-question form', (await p.locator('.habit-form .q').count()) === 3 && (await p.evaluate(() => document.activeElement?.id)) === 'addName');
await p.click('#addForm button[type=submit]'); await p.waitForTimeout(200);
check('Empty name shows a clear error', (await p.locator('.form-error').textContent()).includes('name'));
await p.fill('#addName', 'TEST Specific'); await p.click('[data-when="days"]'); await p.waitForTimeout(150);
check('Typed text survives switching options', (await p.inputValue('#addName')) === 'TEST Specific');
await p.click('#addForm button[type=submit]'); await p.waitForTimeout(200);
check('Specific days with none picked shows an error', (await p.locator('.form-error').textContent()).includes('day'));
await p.click('#addForm .weekday-chip[data-day="1"]'); await p.click('#addForm .weekday-chip[data-day="3"]');
await p.click('[data-duration="10"]');
await p.click('#addForm button[type=submit]'); await p.waitForTimeout(250);
let h = (await habits()).find((x) => x.name === 'TEST Specific');
check('Saved: specific days, 10 minutes', h && JSON.stringify(h.days) === '[1,3]' && h.duration === 10 && h.scheduleType === 'independent');

// Every day with a custom duration
await p.click('#addHabitToggle'); await p.waitForTimeout(200);
await p.fill('#addName', 'TEST Daily');
await p.click('[data-duration="other"]'); await p.waitForTimeout(150);
await p.fill('#addDurationCustom', '25');
await p.click('#addForm button[type=submit]'); await p.waitForTimeout(250);
h = (await habits()).find((x) => x.name === 'TEST Daily');
check('Saved: every day, custom 25 minutes', h && !h.days && h.duration === 25);

// Around a routine, before, 15 min gap
await p.click('#addHabitToggle'); await p.waitForTimeout(200);
await p.fill('#addName', 'TEST Before class');
await p.click('[data-duration="20"]');
await p.click('[data-when="routine"]'); await p.waitForTimeout(150);
await p.click('#addForm button[type=submit]'); await p.waitForTimeout(200);
check('Routine option with none picked shows an error', (await p.locator('.form-error').textContent()).includes('routine'));
await p.locator('.series-select-all[data-series="cls"]').check(); await p.waitForTimeout(150);
await p.click('[data-position="before"]'); await p.click('[data-gap="15"]'); await p.waitForTimeout(150);
const preview = await p.locator('.occurrence-preview').textContent();
check('Preview shows the before-class time', preview.includes('07:25–07:45'), preview.replace(/\s+/g, ' ').slice(0, 80));
await p.click('#addForm button[type=submit]'); await p.waitForTimeout(250);
h = (await habits()).find((x) => x.name === 'TEST Before class');
check('Saved: stacked before Classes (all 3 days), 15 min gap', h && h.scheduleType === 'stacked' && h.stackPosition === 'before' && h.offsetMinutes === 15 && h.stackEventIds.length === 3);
const rowText = await p.locator('.habit-row', { hasText: 'TEST Before class' }).textContent();
check('Row shows "07:25–07:45 · Before Classes"', rowText.includes('07:25–07:45') && rowText.includes('Before Classes'));

// Edit keeps history; delete with undo
const before = (await habits()).find((x) => x.id === 'h1');
await p.click('.habit-edit-trigger[data-id="h1"]'); await p.waitForTimeout(200);
check('Tapping a habit opens it for editing with its current settings', (await p.inputValue('#editName')) === before.name && (await p.getAttribute('[data-when="routine"]', 'aria-checked')) === 'true');
await p.click('#editForm [data-duration="45"]'); await p.click('#editForm [data-gap="30"]');
await p.click('#editForm button[type=submit]'); await p.waitForTimeout(250);
const after = (await habits()).find((x) => x.id === 'h1');
check('Edit saved; completion history unchanged', after.duration === 45 && after.offsetMinutes === 30 && JSON.stringify(after.history) === JSON.stringify(before.history));
await p.click('.habit-edit-trigger[data-id="h1"]'); await p.waitForTimeout(200);
await p.click('#deleteHabitBtn'); await p.waitForTimeout(200);
check('Delete is inside the edit form and offers Undo', !(await habits()).some((x) => x.id === 'h1') && (await p.locator('.undo-toast').count()) === 1);
await p.click('.undo-toast-btn'); await p.waitForTimeout(200);
check('Undo restores the habit exactly', JSON.stringify((await habits()).find((x) => x.id === 'h1')) === JSON.stringify(after));

// No routines yet → "Add a routine" goes to the calendar
await p.evaluate(() => { localStorage.setItem('unmet_events', '[]'); location.hash = '#/insight'; }); await p.waitForTimeout(100);
await p.evaluate(() => { location.hash = '#/'; }); await p.waitForTimeout(300);
await p.click('#addHabitToggle'); await p.click('[data-when="routine"]'); await p.waitForTimeout(150);
await p.click('#goAddRoutineBtn'); await p.waitForTimeout(300);
check('No routines: "Add a routine" takes you to the calendar', (await p.evaluate(() => location.hash)) === '#/calendar');
check('No page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
