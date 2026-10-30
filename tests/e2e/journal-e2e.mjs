// Phase 9: journaling usability — all three journals kept, existing entries intact, drafts survive
// reloads, private save without AI, full past entries, evening mic + labelled mood scale.
import { createRequire } from 'module';
const require = createRequire('/opt/node-tools/node_modules/dummy.js');
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
let pass = 0, fail = 0; const errors = [];
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const today = '2026-10-28';

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Riyadh' });
const p = await ctx.newPage();
p.on('pageerror', (e) => errors.push(e.message));
const planCalls = [];
await p.route('**/api/plan', (r) => { planCalls.push(1); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ goals: [{ id: 'g0', text: 'Run a 5k', importance: 'high', urgency: 'low', firstStep: { type: 'stack', label: 'Jog 10 min after work' } }] }) }); });
await p.clock.setFixedTime(new Date('2026-10-28T19:00:00+03:00'));
await p.goto('http://localhost:8090/seed.html?r=journal&theme=dark', { waitUntil: 'networkidle' });
// Existing entries from before this change (synthetic)
const long = 'Older entry. '.repeat(30) + 'END-OF-ENTRY';
await p.evaluate(({ today, long }) => {
  localStorage.setItem('unmet_freeform', JSON.stringify([
    { id: 'f1', text: long, createdAt: '2026-10-20T10:00:00.000Z', plan: { goals: [{ id: 'g0', text: 'Old goal', importance: 'low', urgency: 'low', firstStep: { type: 'task', label: 'x' } }] } },
    ...Array.from({ length: 9 }, (_, i) => ({ id: `o${i}`, text: `Short note ${i}`, createdAt: `2026-10-0${i + 1}T10:00:00.000Z`, plan: null })),
  ]));
  localStorage.removeItem('unmet_morning'); localStorage.removeItem('unmet_evening');
}, { today, long });
const before = await p.evaluate(() => localStorage.getItem('unmet_freeform'));
await p.evaluate(() => { location.hash = '#/'; }); await p.waitForTimeout(80);
await p.evaluate(() => { location.hash = '#/journal'; }); await p.waitForTimeout(250);

check('All three journals still offered', (await p.locator('.journal-link').count()) === 3);
check('Hub shows last free-style entry date', (await p.locator('.journal-link[data-path="/journal/freeform"]').textContent()).includes('Last entry'));

// Morning: draft survives a reload, then saves
await p.click('.journal-link[data-path="/journal/morning"]'); await p.waitForTimeout(200);
await p.fill('.priority-text[data-i="0"]', 'Finish lab report');
await p.click('.importance-chip[data-i="0"][data-level="high"]'); await p.waitForTimeout(80);
await p.fill('.priority-minutes[data-i="0"]', '45');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(300);
check('Morning draft restored after reload', (await p.inputValue('.priority-text[data-i="0"]')) === 'Finish lab report' && (await p.getAttribute('.importance-chip[data-i="0"][data-level="high"]', 'aria-pressed')) === 'true' && (await p.inputValue('.priority-minutes[data-i="0"]')) === '45' && (await p.locator('.draft-note').count()) === 1);
await p.click('#backBtn'); await p.waitForTimeout(150);
check('Hub flags the unsaved morning draft', (await p.locator('.journal-link[data-path="/journal/morning"] .hub-draft').count()) === 1);
await p.click('.journal-link[data-path="/journal/morning"]'); await p.waitForTimeout(150);
await p.click('#saveBtn'); await p.waitForTimeout(200);
const m = await p.evaluate((d) => JSON.parse(localStorage.getItem('unmet_morning'))[d], today);
check('Morning saved as before; draft cleared', m && m.priorities[0].text === 'Finish lab report' && m.priorities[0].importance === 'high' && !(await p.evaluate(() => localStorage.getItem('unmet_journal_drafts'))));

// Evening: mic, labelled mood, draft
await p.evaluate(() => { location.hash = '#/journal/evening'; }); await p.waitForTimeout(250);
check('Evening reflection has speech-to-text', (await p.locator('#eveningMic').count()) === 1);
check('Mood scale is labelled', (await p.getAttribute('.scale-dot[data-n="1"]', 'aria-label')) === 'Very hard' && (await p.getAttribute('.scale-dot[data-n="5"]', 'aria-label')) === 'Great' && (await p.locator('.scale-ends').textContent()).includes('Very hard'));
await p.click('.completion-toggle[data-i="0"]'); await p.fill('#obstacleInput', 'Long meeting'); await p.click('.scale-dot[data-n="4"]'); await p.waitForTimeout(100);
check('Choosing a mood keeps typed text', (await p.inputValue('#obstacleInput')) === 'Long meeting' && (await p.locator('.scale-current').textContent()) === 'Good');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(300);
check('Evening draft restored after reload', (await p.inputValue('#obstacleInput')) === 'Long meeting' && (await p.getAttribute('.scale-dot[data-n="4"]', 'aria-checked')) === 'true' && (await p.getAttribute('.completion-toggle[data-i="0"]', 'aria-pressed')) === 'true');
await p.click('#saveBtn'); await p.waitForTimeout(200);
const ev = await p.evaluate((d) => JSON.parse(localStorage.getItem('unmet_evening'))[d], today);
check('Evening saved in the same format', ev && ev.completion[0] === true && ev.obstacle === 'Long meeting' && ev.mood === 4);

// Free-style
await p.evaluate(() => { location.hash = '#/journal/freeform'; }); await p.waitForTimeout(250);
check('Existing entries untouched', (await p.evaluate(() => localStorage.getItem('unmet_freeform'))) === before);
check('Speech-to-text still on free-style', (await p.locator('#journalMic').count()) === 1);
check('Explains what AI planning sends', (await p.locator('.form-note').filter({ hasText: 'AI service' }).count()) === 1);
await p.fill('#brainDump', 'Private thoughts about today');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(300);
check('Free-style draft restored after reload', (await p.inputValue('#brainDump')) === 'Private thoughts about today');
await p.click('#saveEntryBtn'); await p.waitForTimeout(200);
const ff = await p.evaluate(() => JSON.parse(localStorage.getItem('unmet_freeform')));
check('"Save entry" saves locally with no AI call', ff[0].text === 'Private thoughts about today' && ff[0].plan === null && planCalls.length === 0 && ff.length === 11);
check('Confirms it stayed on this device', (await p.locator('[role=status]').filter({ hasText: 'Saved on this device' }).count()) === 1);
check('Draft cleared after saving', (await p.inputValue('#brainDump')) === '' && !(await p.evaluate(() => localStorage.getItem('unmet_journal_drafts'))));

// Past entries
check('First 8 past entries shown, with "show all"', (await p.locator('.entry-card').count()) === 8 && (await p.locator('#showAllEntries').count()) === 1);
await p.click('#showAllEntries'); await p.waitForTimeout(150);
check('Show all lists every entry', (await p.locator('.entry-card').count()) === 11);
const card = p.locator('.entry-card', { hasText: 'Older entry' });
check('Long entries start collapsed', !(await card.locator('.entry-text').isVisible()));
await card.locator('summary').click(); await p.waitForTimeout(100);
check('"Read all" shows the full text', (await card.locator('.entry-text').textContent()).includes('END-OF-ENTRY'));
await card.locator('.open-plan').click(); await p.waitForTimeout(200);
check('A past plan can be reopened', (await p.locator('.plan-goal-card').textContent()).includes('Old goal'));

// AI plan still works as before
await p.click('#tabs [data-val="write"]'); await p.waitForTimeout(100);
await p.fill('#brainDump', 'I want to run a 5k');
await p.click('#planBtn'); await p.waitForTimeout(400);
check('"Turn into a plan" still calls the AI and shows the plan', planCalls.length === 1 && (await p.locator('.plan-goal-card').textContent()).includes('Run a 5k'));

// Hostile journal text is shown as text (evening labels use priority text in attributes)
await p.evaluate((d) => { const m = JSON.parse(localStorage.getItem('unmet_morning')); m[d].priorities[1].text = '" autofocus onfocus="window.__pwned=1" x="'; localStorage.setItem('unmet_morning', JSON.stringify(m)); location.hash = '#/journal/evening'; }, today);
await p.waitForTimeout(300);
check('Priority text can\'t break out of attributes', !(await p.evaluate(() => window.__pwned)) && (await p.locator('[onfocus]').count()) === 0);

check('No page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
