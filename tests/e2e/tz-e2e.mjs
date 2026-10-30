import { createRequire } from 'module';
const require = createRequire('/opt/node-tools/node_modules/dummy.js');
const { chromium } = require('playwright');

const BASE = 'http://localhost:8090/seed.html';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
let pass = 0, fail = 0;
const errors = [];
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; if (!ok || process.env.VERBOSE) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
const dow = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

const CASES = [
  ['UTC', '2026-10-24T12:00:00Z', '2026-10-24'],
  ['Asia/Riyadh', '2026-10-24T12:00:00+03:00', '2026-10-24'],
  ['Asia/Riyadh', '2026-10-25T00:00:30+03:00', '2026-10-25'],
  ['Asia/Riyadh', '2026-10-25T01:30:00+03:00', '2026-10-25'],
  ['Asia/Riyadh', '2026-10-24T23:59:30+03:00', '2026-10-24'],
  ['America/New_York', '2026-10-24T21:00:00-04:00', '2026-10-24'],
  ['America/New_York', '2026-10-24T23:59:30-04:00', '2026-10-24'],
  ['America/New_York', '2026-11-01T01:30:00-05:00', '2026-11-01'], // fall back (second 01:30)
  ['America/New_York', '2026-03-08T03:30:00-04:00', '2026-03-08'], // spring forward
  ['Asia/Tokyo', '2026-10-25T08:00:00+09:00', '2026-10-25'],
  ['Asia/Tokyo', '2026-10-25T00:10:00+09:00', '2026-10-25'],
];

for (const [tz, instant, today] of CASES) {
  const label = `${tz} @ ${instant}`;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: tz });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await p.clock.setFixedTime(new Date(instant));
  await p.goto(`${BASE}?r=&theme=dark`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(250);

  const sunday = addDays(today, -dow(today));
  const expectWeek = Array.from({ length: 7 }, (_, i) => addDays(sunday, i));

  const strip = await p.$$eval('.day-pill', (els) => els.map((e) => ({ d: e.dataset.date, today: e.classList.contains('today'), n: e.querySelector('.n')?.firstChild?.textContent.trim() })));
  check(`${label}: Home week strip is Sun–Sat of the local week`, JSON.stringify(strip.map((s) => s.d)) === JSON.stringify(expectWeek), strip.map((s) => s.d).join(' '));
  check(`${label}: Home marks local today`, strip.filter((s) => s.today).map((s) => s.d).join() === today);
  check(`${label}: Home day numbers match their dates`, strip.every((s) => Number(s.d.slice(8)) === Number(s.n)));

  // Check off the first habit in today's list; it must be stored under the local date.
  const firstId = await p.$eval('.habit-check', (b) => b.dataset.id).catch(() => null);
  if (firstId) {
    const before = await p.evaluate((id) => JSON.parse(localStorage.getItem('unmet_habits')).find((h) => h.id === id).history, firstId);
    await p.click(`.habit-check[data-id="${firstId}"]`);
    await p.waitForTimeout(120);
    const after = await p.evaluate((id) => JSON.parse(localStorage.getItem('unmet_habits')).find((h) => h.id === id).history, firstId);
    const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]);
    check(`${label}: check-off saved under local today only`, changed.length === 1 && changed[0] === today, `changed: ${changed.join(',')}`);
  } else {
    check(`${label}: a habit is scheduled today`, false);
  }

  // Calendar Day view
  await p.evaluate(() => { location.hash = '#/calendar'; });
  await p.waitForTimeout(200);
  await p.click('#viewToggle [data-val="day"]');
  await p.waitForTimeout(150);
  const dayStrip = await p.$$eval('.day-pill', (els) => els.map((e) => e.dataset.date));
  const selected = await p.$eval('.day-pill.selected', (e) => e.dataset.date).catch(() => null);
  check(`${label}: Day view strip is the local week, today selected`, JSON.stringify(dayStrip) === JSON.stringify(expectWeek) && selected === today, `${dayStrip.join(' ')} sel=${selected}`);

  // Week view
  await p.click('#viewToggle [data-val="week"]');
  await p.waitForTimeout(200);
  const cols = await p.$$eval('.week-day-col-header', (els) => els.map((e) => ({ d: e.dataset.date, today: e.classList.contains('today') })));
  check(`${label}: Week view is Sun–Sat containing today`, JSON.stringify(cols.map((c) => c.d)) === JSON.stringify(expectWeek) && cols.find((c) => c.today)?.d === today, cols.map((c) => c.d).join(' '));
  // Recurring routine (Classes Sun/Tue/Thu) and its stacked habit appear on the right columns
  const perCol = await p.$$eval('.week-day-col-body', (els) => els.map((e) => ({ d: e.dataset.date, titles: [...e.querySelectorAll('.gb-title')].map((t) => t.textContent.trim()) })));
  const classDays = perCol.filter((c) => c.titles.some((t) => t.startsWith('Classes'))).map((c) => dow(c.d));
  check(`${label}: Classes shown on Sun/Tue/Thu only`, JSON.stringify(classDays) === JSON.stringify([0, 2, 4]), classDays.join(','));
  const stackDays = perCol.filter((c) => c.titles.some((t) => t.includes('Review math'))).map((c) => dow(c.d));
  check(`${label}: stacked habit follows Classes`, JSON.stringify(stackDays) === JSON.stringify([0, 2, 4]), stackDays.join(','));
  // Next / previous week stay 7 consecutive days
  await p.click('#nextBtn'); await p.waitForTimeout(150);
  const next = await p.$$eval('.week-day-col-header', (els) => els.map((e) => e.dataset.date));
  check(`${label}: next week is the following Sun–Sat`, next[0] === addDays(sunday, 7) && next[6] === addDays(sunday, 13), next.join(' '));
  await ctx.close();
}

// Midnight rollover while the app is open (Riyadh): Home follows the new day after the tab returns.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Riyadh' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`rollover: ${e.message}`));
  await p.clock.install({ time: new Date('2026-10-24T23:59:00+03:00') });
  await p.goto(`${BASE}?r=&theme=dark`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  const before = await p.$eval('.day-pill.today', (e) => e.dataset.date);
  await p.clock.fastForward('02:00');
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await p.waitForTimeout(200);
  const after = await p.$eval('.day-pill.today', (e) => e.dataset.date);
  const sel = await p.$eval('.day-pill.selected', (e) => e.dataset.date);
  check('Riyadh: Home rolls over from 23:59 to 00:01 when the tab returns', before === '2026-10-24' && after === '2026-10-25' && sel === '2026-10-25', `${before} → ${after}, selected ${sel}`);
  await ctx.close();
}

console.log(`\n${pass} passed, ${fail} failed; page errors: ${JSON.stringify(errors)}`);
await browser.close();
process.exit(fail ? 1 : 0);
