// Phase 8: reminders — opt-in, permission flow, due-time notifications while open, per-habit mute,
// no repeats, honest unsupported/denied/iPhone states. Notification API is faked in the page.
import { createRequire } from 'module';
const require = createRequire('/opt/node-tools/node_modules/dummy.js');
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
let pass = 0, fail = 0; const errors = [];
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

const fake = (perm, answer) => `
  window.__notes = JSON.parse(sessionStorage.getItem('__notes') || '[]');
  window.__asked = 0;
  class FakeNotification {
    constructor(title, opts) { window.__notes.push({ title, body: opts && opts.body }); sessionStorage.setItem('__notes', JSON.stringify(window.__notes)); }
    close() {}
    static get permission() { return sessionStorage.getItem('__perm') || '${perm}'; }
    static async requestPermission() { window.__asked++; sessionStorage.setItem('__perm', '${answer}'); return '${answer}'; }
  }
  window.Notification = FakeNotification;
`;

async function open({ perm = 'default', answer = 'granted', time = '2026-10-28T21:00:00+03:00', ua, noApi = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Riyadh', ...(ua ? { userAgent: ua } : {}) });
  await ctx.addInitScript(noApi ? 'delete window.Notification;' : fake(perm, answer));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.clock.install({ time: new Date(time) });
  await p.goto('http://localhost:8090/seed.html?r=settings&theme=dark', { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  return { ctx, p };
}
const notes = (p) => p.evaluate(() => window.__notes || []);

{
  const { ctx, p } = await open();
  check('Reminders are off by default', !(await p.isChecked('#remindersToggle')) && (await p.evaluate(() => localStorage.getItem('unmet_reminders'))) === null);
  check('Limits explained up front', (await p.locator('.reminders-card').textContent()).includes('only appear while Unmet is open'));
  check('No permission prompt until the user asks', (await p.evaluate(() => window.__asked)) === 0);
  await p.check('#remindersToggle'); await p.waitForTimeout(200);
  check('Turning on asks the browser once and confirms', (await p.evaluate(() => window.__asked)) === 1 && (await p.locator('.reminders-card [role=status]').textContent()).includes('on for this browser'));
  await p.click('[data-lead="10"]'); await p.waitForTimeout(100);
  check('Lead time saved', JSON.parse(await p.evaluate(() => localStorage.getItem('unmet_reminders'))).lead === 10);
  await p.click('#testReminderBtn'); await p.waitForTimeout(100);
  check('Test reminder shows', (await notes(p)).some((n) => n.title === 'Unmet reminder test'));

  // "Read 20 pages" is at 21:30 but already done today in the seed; make it not done and add a muted one.
  await p.evaluate(() => {
    const d = new Date(); const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const hs = JSON.parse(localStorage.getItem('unmet_habits'));
    hs.find((h) => h.id === 'h2').history[today] = false;
    hs.push({ id: 'm', name: 'Muted one', scheduleType: 'independent', time: '21:30', duration: 10, createdAt: '2026-09-01', history: {}, remind: false });
    localStorage.setItem('unmet_habits', JSON.stringify(hs));
    location.hash = '#/';
  });
  await p.clock.fastForward('20:00'); // 21:20 = 10 minutes before 21:30
  await p.waitForTimeout(300);
  let n = await notes(p);
  check('Due habit reminded 10 minutes before, with its time', n.some((x) => x.title === 'Read 20 pages' && x.body.includes('21:30') && x.body.includes('10 minutes')), JSON.stringify(n));
  check('Muted habit is not reminded', !n.some((x) => x.title === 'Muted one'));
  await p.clock.fastForward('02:00'); await p.waitForTimeout(200);
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(300);
  n = await notes(p);
  check('No repeat after time passes or a reload', n.filter((x) => x.title === 'Read 20 pages').length === 1, String(n.length));

  // Per-habit switch in the habit form
  await p.click('.habit-edit-trigger[data-id="h3"]').catch(async () => { await p.click('.day-pill >> nth=1'); });
  await p.evaluate(() => { location.hash = '#/settings'; }); await p.waitForTimeout(100);
  await p.evaluate(() => { location.hash = '#/'; }); await p.waitForTimeout(200);
  await p.click('#addHabitToggle'); await p.waitForTimeout(150);
  check('Habit form offers "Remind me" when reminders are on', await p.isChecked('#addRemind'));
  await p.fill('#addName', 'TEST quiet'); await p.uncheck('#addRemind');
  await p.click('#addForm button[type=submit]'); await p.waitForTimeout(200);
  check('Unticking saves remind:false on that habit only', (await p.evaluate(() => JSON.parse(localStorage.getItem('unmet_habits')).find((h) => h.name === 'TEST quiet').remind)) === false);

  // Turning off
  await p.evaluate(() => { location.hash = '#/settings'; }); await p.waitForTimeout(200);
  await p.uncheck('#remindersToggle'); await p.waitForTimeout(150);
  check('Turning off is saved', JSON.parse(await p.evaluate(() => localStorage.getItem('unmet_reminders'))).enabled === false);
  await ctx.close();
}

{
  const { ctx, p } = await open({ answer: 'denied' });
  await p.click('#remindersToggle'); await p.waitForTimeout(200);
  check('Permission refused: stays off, explains how to allow', !(await p.isChecked('#remindersToggle')) && (await p.locator('.reminders-card').textContent()).includes('blocked for this site'));
  check('Habit form has no reminder switch when off', await (async () => { await p.evaluate(() => { location.hash = '#/'; }); await p.waitForTimeout(200); await p.click('#addHabitToggle'); return (await p.locator('#addRemind').count()) === 0; })());
  await ctx.close();
}

{
  const { ctx, p } = await open({ noApi: true });
  check('No Notification support: explained, no toggle', (await p.locator('#remindersToggle').count()) === 0 && (await p.locator('.reminders-card').textContent()).includes("can't show notifications"));
  await ctx.close();
}

{
  const { ctx, p } = await open({ noApi: true, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
  check('iPhone: explains Home Screen / push limitation', (await p.locator('.reminders-card').textContent()).includes('iPhone and iPad'));
  await ctx.close();
}

{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar' });
  await ctx.addInitScript(fake('default', 'granted'));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://localhost:8090/seed.html?r=settings&theme=light&lang=ar', { waitUntil: 'networkidle' }); await p.waitForTimeout(250);
  check('Arabic reminders section', (await p.locator('.reminders-card').textContent()).includes('التذكيرات'));
  await ctx.close();
}

check('No page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
