// Phase 7: AI Task Splitter (endpoint mocked in the browser — no real AI calls, no cost).
import { createRequire } from 'module';
const require = createRequire('/opt/node-tools/node_modules/dummy.js');
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
let pass = 0, fail = 0; const errors = [];
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const STEPS = { steps: [
  { text: 'Open the syllabus and list the three nearest deadlines', minutes: 10, importance: 'hi', urgency: 'hi', kind: 'task' },
  { text: 'Review chapter 5 notes after class', minutes: 20, importance: 'hi', urgency: 'lo', kind: 'habit' },
  { text: 'Book a 2-hour study block on Thursday', minutes: 120, importance: 'hi', urgency: 'lo', kind: 'event' },
  { text: 'Email the TA one question about titration', minutes: 5, importance: 'lo', urgency: 'hi', kind: 'task' },
] };

async function open(lang = 'en', reply) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Riyadh' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  const sent = [];
  await p.route('**/api/split', async (r) => { sent.push(JSON.parse(r.request().postData())); await new Promise((x) => setTimeout(x, 150)); await reply(r); });
  await p.clock.setFixedTime(new Date('2026-10-28T10:00:00+03:00'));
  await p.goto(`http://localhost:8090/seed.html?r=tasks&theme=dark&lang=${lang}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(250);
  return { ctx, p, sent };
}
const ok = (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STEPS) });
const goals = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('unmet_goals')));

{
  const { ctx, p, sent } = await open('en', ok);
  check('Speech-to-text button still present', (await p.locator('#taskMic, [data-mic="taskMic"], .mic-btn').count()) > 0);
  check('Privacy note says what is sent', (await p.locator('.split-form').textContent()).includes('sent to Unmet\'s AI service'));
  await p.click('#goalForm button[type=submit]'); await p.waitForTimeout(100);
  check('Empty task: nothing sent', sent.length === 0);
  await p.click('.split-personalize summary');
  await p.click('.challenge-chip[data-challenge="time"]'); await p.click('.challenge-chip[data-challenge="starting"]');
  await p.fill('#splitNote', 'I work evenings'); await p.locator('#splitNote').blur();
  await p.fill('#goalInput', 'Prepare for my chemistry midterm');
  await p.click('#goalForm button[type=submit]');
  await p.waitForTimeout(60);
  check('Shows a busy state while waiting', (await p.locator('#goalForm button[type=submit]').textContent()).includes('Breaking') && await p.isDisabled('#goalForm button[type=submit]'));
  await p.waitForTimeout(400);
  check('Sends only the task, chosen challenges, note and language', JSON.stringify(sent[0]) === JSON.stringify({ goal: 'Prepare for my chemistry midterm', challenges: ['time', 'starting'], note: 'I work evenings', lang: 'en' }), JSON.stringify(sent[0]));
  const g = (await goals(p))[0];
  check('AI steps saved with minutes, matrix values and kind', g.source === 'ai' && g.subtasks.length === 4 && g.subtasks[2].minutes === 120 && g.subtasks[0].importance === 'hi' && g.subtasks[1].kind === 'habit');
  check('Steps shown with length and matrix label; matrix kept', (await p.locator('.goal-card').first().textContent()).includes('10 min · Do now') && (await p.locator('.goal-card').first().locator('.matrix-mini').count()) === 1);
  check('AI label invites editing or skipping', (await p.locator('.split-source').first().textContent()).includes('written by AI'));
  check('Personalization remembered on this device', (await p.evaluate(() => localStorage.getItem('unmet_split_prefs'))).includes('evenings'));

  // Step → calendar event
  await p.locator('.goal-card').first().locator('.convert-trigger').nth(2).click(); await p.waitForTimeout(120);
  check('A step offers habit, calendar and task', (await p.locator('.convert-options button').count()) === 3);
  await p.click('.convert-event'); await p.waitForTimeout(350);
  const title = await p.inputValue('#evTitle').catch(() => '');
  const s = await p.inputValue('#evStart').catch(() => ''); const e = await p.inputValue('#evEnd').catch(() => '');
  const mins = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
  check('"Put it on the calendar" opens a prefilled event with the step\'s length', (await p.evaluate(() => location.hash)) === '#/calendar' && title === 'Book a 2-hour study block on Thursday' && mins(e) - mins(s) === 120, `${title} ${s}-${e}`);
  await p.click('#eventForm button[type=submit]'); await p.waitForTimeout(200);
  check('Event saved only after the user confirms in the form', (await p.evaluate(() => JSON.parse(localStorage.getItem('unmet_events')).some((x) => x.title === 'Book a 2-hour study block on Thursday'))));

  // Step → habit
  await p.evaluate(() => { location.hash = '#/tasks'; }); await p.waitForTimeout(250);
  check('Converted step is marked', (await p.locator('.goal-card').first().textContent()).includes('added to the calendar'));
  await p.locator('.goal-card').first().locator('.convert-trigger').nth(1).click(); await p.click('.convert-habit'); await p.waitForTimeout(350);
  check('"Make it a habit" opens the habit form prefilled (name + 20 min)', (await p.evaluate(() => location.hash)) === '#/' && (await p.inputValue('#addName')) === 'Review chapter 5 notes after class' && (await p.getAttribute('#addForm [data-duration="20"]', 'aria-pressed')) === 'true');

  // Step → task
  await p.evaluate(() => { location.hash = '#/tasks'; }); await p.waitForTimeout(250);
  await p.locator('.goal-card').first().locator('.convert-trigger').first().click(); await p.click('.convert-task'); await p.waitForTimeout(200);
  check('"Make it a task" adds it as its own task', (await goals(p))[0].text === 'Open the syllabus and list the three nearest deadlines');

  // Done toggle + delete with undo still work
  await p.locator('.subtask-toggle').first().click().catch(() => {});
  const before = (await goals(p)).length;
  await p.locator('.goal-remove').first().click(); await p.waitForTimeout(120);
  await p.click('.undo-toast-btn'); await p.waitForTimeout(120);
  check('Delete + undo still work', (await goals(p)).length === before);
  await ctx.close();
}

// Failures fall back to the starter templates with an honest note
for (const [label, reply, expect] of [
  ['server down (503)', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"x"}' }), 'wasn\'t available'],
  ['rate limited (429)', (r) => r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"x"}' }), 'today\'s AI limit'],
  ['offline', (r) => r.abort('internetdisconnected'), 'wasn\'t available'],
  ['garbage response', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"steps":"nope"}' }), 'wasn\'t available'],
]) {
  const { ctx, p } = await open('en', reply);
  await p.fill('#goalInput', 'Get better grades'); await p.click('#goalForm button[type=submit]'); await p.waitForTimeout(500);
  const g = (await goals(p))[0];
  check(`${label}: starter steps saved, user told why`, g.text === 'Get better grades' && g.source === 'template' && g.subtasks.length === 6 && (await p.locator('.split-fallback').textContent()).includes(expect));
  await ctx.close();
}

// Hostile step text from the server is shown as text
{
  const { ctx, p } = await open('en', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ steps: [{ text: '<img src=x onerror="window.__pwned=1">', minutes: 5, importance: 'hi', urgency: 'hi', kind: 'task' }, { text: 'Second', minutes: 5, importance: 'lo', urgency: 'lo', kind: 'task' }] }) }));
  await p.fill('#goalInput', 'x task'); await p.click('#goalForm button[type=submit]'); await p.waitForTimeout(500);
  check('Step text never runs as markup', !(await p.evaluate(() => window.__pwned)) && (await p.locator('.goal-card img').count()) === 0);
  await ctx.close();
}

// Arabic
{
  const { ctx, p, sent } = await open('ar', ok);
  await p.fill('#goalInput', 'الاستعداد لاختبار الكيمياء'); await p.click('#goalForm button[type=submit]'); await p.waitForTimeout(500);
  check('Arabic: language sent so steps come back in Arabic', sent[0].lang === 'ar');
  await ctx.close();
}

check('No page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
