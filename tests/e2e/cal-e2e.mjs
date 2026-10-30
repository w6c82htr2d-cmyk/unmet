// Phase 3: calendar — Overview default on phones, plain-language entry with confirmation,
// simpler routine form, routine day editing with undo, grouped routine list.
import { createRequire } from 'module';
const require = createRequire('/opt/node-tools/node_modules/dummy.js');
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
let pass = 0, fail = 0; const errors = [];
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const T0 = new Date('2026-10-27T18:00:00+03:00'); // Tuesday
const today = '2026-10-27';

async function open(lang = 'en', width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, timezoneId: 'Asia/Riyadh' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.clock.setFixedTime(T0);
  await p.goto(`http://localhost:8090/seed.html?r=calendar&theme=dark&lang=${lang}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(350);
  return { ctx, p };
}
const events = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('unmet_events')));

{
  const { ctx, p } = await open();
  // ---- Overview is the phone default ----
  check('Phone: first visit opens the compact Overview', await p.getAttribute('#viewToggle [data-val="agenda"]', 'aria-checked') === 'true' && (await p.locator('#agendaList').count()) === 1);
  const items = await p.$$eval('.agenda-item', (els) => els.map((e) => e.querySelector('.ag-time span').textContent + ' ' + e.querySelector('.ag-title').textContent.trim()));
  const times = items.map((s) => s.slice(0, 5));
  check('Overview lists the day in time order', items.length >= 4 && times.join() === [...times].sort().join(), items.join(' | '));
  check('Overview shows the stacked habit with its routine', (await p.locator('.agenda-item.habit', { hasText: 'Review math notes' }).textContent()).includes('After Classes'));
  check('Overview shows free time with a quick add', (await p.locator('.agenda-gap').count()) > 0);
  const docH = await p.evaluate(() => document.documentElement.scrollHeight);
  await p.click('#viewToggle [data-val="day"]'); await p.waitForTimeout(150);
  const dayH = await p.evaluate(() => document.documentElement.scrollHeight);
  check('Overview needs less scrolling than the hour grid', docH < dayH, `${docH} vs ${dayH}`);
  check('Day view still available and remembered', (await p.locator('#dayCol').count()) === 1 && (await p.evaluate(() => localStorage.getItem('unmet_calendar_view'))) === '"day"');
  await p.click('#viewToggle [data-val="agenda"]'); await p.waitForTimeout(150);

  // ---- Navigation: today button only when away from today ----
  check('"Today" hidden while on today', (await p.locator('#todayBtn').count()) === 0);
  await p.click('#nextBtn'); await p.waitForTimeout(120);
  check('Next moves one day and offers "Today"', (await p.$eval('.day-pill.selected', (e) => e.dataset.date)) === '2026-10-28' && (await p.locator('#todayBtn').count()) === 1);
  await p.click('#todayBtn'); await p.waitForTimeout(120);

  // ---- Gap quick-add opens the form at that time ----
  const gapStart = await p.$eval('.gap-add', (b) => b.dataset.start);
  await p.click('.gap-add'); await p.waitForTimeout(250);
  check('Free-time + opens a one-time form at that time', (await p.inputValue('#evStart')) === gapStart && (await p.getAttribute('#eventForm [data-type="once"]', 'aria-checked')) === 'true');
  await p.click('#cancelFormBtn'); await p.waitForTimeout(120);

  // ---- Plain-language entry: preview first, nothing saved until confirmed ----
  const before = (await events(p)).length;
  await p.click('#addMenuBtn'); await p.waitForTimeout(150);
  check('Add menu focuses the plain-language box', (await p.evaluate(() => document.activeElement?.id)) === 'nlInput');
  await p.fill('#nlInput', 'Lab every Monday and Wednesday 2-4pm');
  await p.click('#nlForm button[type=submit]'); await p.waitForTimeout(200);
  const prev = (await p.locator('.nl-preview').textContent()).replace(/\s+/g, ' ');
  check('Preview shows name, days, time and duration', prev.includes('Lab') && prev.includes('Every Mon, Wed') && prev.includes('14:00–16:00') && prev.includes('2 h'), prev.slice(0, 160));
  check('Preview shows the time zone used', prev.includes('Asia/Riyadh'));
  check('Nothing saved before confirming', (await events(p)).length === before);
  await p.click('#nlSaveBtn'); await p.waitForTimeout(300);
  const lab = (await events(p)).filter((e) => e.title === 'Lab');
  check('Confirmed: one routine on Mon + Wed, 14:00–16:00, from today', lab.length === 2 && new Set(lab.map((e) => e.seriesId)).size === 1 && lab.map((e) => e.dayOfWeek).sort().join() === '1,3' && lab.every((e) => e.start === '14:00' && e.end === '16:00' && e.startDate === today));
  check('"Your routine is set" card follows, with Add Habit focused', (await p.locator('.guidance-card.accent').textContent()).includes('Lab') && (await p.evaluate(() => document.activeElement?.id)) === 'goAddHabitBtn');

  // Missing information blocks saving and can be finished in the form
  await p.click('#addMenuBtn'); await p.waitForTimeout(120);
  await p.fill('#nlInput', 'Piano lessons every Friday');
  await p.click('#nlForm button[type=submit]'); await p.waitForTimeout(200);
  check('Missing time: clear message, Save disabled', (await p.locator('.nl-preview .form-error').textContent()).includes('start time') && await p.isDisabled('#nlSaveBtn'));
  await p.click('#nlEditBtn'); await p.waitForTimeout(250);
  check('"Edit details" opens the routine form prefilled', (await p.inputValue('#evTitle')) === 'Piano lessons' && (await p.getAttribute('.form-day[data-day="5"]', 'aria-pressed')) === 'true');
  await p.fill('#evStart', '17:00'); await p.fill('#evEnd', '16:00');
  await p.click('#eventForm button[type=submit]'); await p.waitForTimeout(200);
  check('End before start is caught with a clear message', (await p.locator('#eventForm .form-error').textContent()).includes('after the start'));
  check('Typed values survive the error', (await p.inputValue('#evTitle')) === 'Piano lessons' && (await p.inputValue('#evStart')) === '17:00');
  await p.fill('#evEnd', '18:00');
  check('Duration is shown as times change', (await p.locator('.dur-note').textContent()).includes('1 h'));
  await p.click('#eventForm button[type=submit]'); await p.waitForTimeout(250);
  check('Saved after fixing; success card shown again', (await events(p)).some((e) => e.title === 'Piano lessons' && e.dayOfWeek === 5 && e.start === '17:00') && (await p.locator('.guidance-card.accent', { hasText: 'Piano lessons' }).count()) === 1);
  await p.click('#maybeLaterBtn'); await p.waitForTimeout(100);

  // ---- Step-by-step routine with a week preset ----
  await p.click('#addMenuBtn'); await p.click('#addRoutineQuickBtn'); await p.waitForTimeout(250);
  await p.fill('#evTitle', 'Work');
  await p.click('.day-preset[data-days="1,2,3,4,5"]'); await p.waitForTimeout(100);
  check('Mon–Fri preset selects five days', (await p.$$eval('.form-day[aria-pressed="true"]', (b) => b.map((x) => x.dataset.day).join())) === '1,2,3,4,5' && (await p.inputValue('#evTitle')) === 'Work');
  await p.fill('#evStart', '09:00'); await p.fill('#evEnd', '17:00');
  await p.click('#eventForm button[type=submit]'); await p.waitForTimeout(250);
  check('Routine saved on five days', (await events(p)).filter((e) => e.title === 'Work').length === 5);
  await p.click('#maybeLaterBtn'); await p.waitForTimeout(100);

  // ---- Grouped list: one row per routine; edit days with undo ----
  const routineRows = await p.$$eval('.manage-row', (rs) => rs.map((r) => r.querySelector('.mr-title').textContent.trim()));
  check('Routine list shows each routine once', routineRows.filter((t) => t === 'Classes').length === 1 && routineRows.filter((t) => t === 'Work').length === 1);
  check('Routine row lists its days', (await p.locator('.manage-row', { hasText: 'Classes' }).textContent()).includes('Sun, Tue, Thu'));
  const habitsBefore = await p.evaluate(() => JSON.parse(localStorage.getItem('unmet_habits')).find((h) => h.id === 'h1'));
  const classesBefore = (await events(p)).filter((e) => e.seriesId === 'cls');
  await p.click('.routine-edit[data-series="cls"]'); await p.waitForTimeout(200);
  check('Editing a routine shows its days', (await p.$$eval('.modal-day[aria-pressed="true"]', (b) => b.map((x) => x.dataset.day).join())) === '0,2,4' && (await p.locator('input[name="editScope"]').count()) === 0);
  await p.click('.modal-day[data-day="4"]'); await p.click('.modal-day[data-day="1"]');
  await p.fill('#modalStart', '08:30');
  await p.click('#eventEditForm button[type=submit]'); await p.waitForTimeout(250);
  const cls = (await events(p)).filter((e) => e.seriesId === 'cls' && e.type === 'weekly');
  check('Days changed: Thu removed, Mon added, kept days keep their ids', cls.map((e) => e.dayOfWeek).sort().join() === '0,1,2' && cls.some((e) => e.id === 'cls0') && cls.some((e) => e.id === 'cls2') && !cls.some((e) => e.id === 'cls4'));
  check('New time applied to every day', cls.every((e) => e.start === '08:30' && e.end === '10:50'));
  check('Undo offered after saving changes', (await p.locator('.undo-toast').textContent()).includes('Changes saved'));
  await p.click('.undo-toast-btn'); await p.waitForTimeout(200);
  check('Undo restores the routine exactly', JSON.stringify((await events(p)).filter((e) => e.seriesId === 'cls')) === JSON.stringify(classesBefore));
  check('Habit stacked on it is untouched', JSON.stringify(await p.evaluate(() => JSON.parse(localStorage.getItem('unmet_habits')).find((h) => h.id === 'h1'))) === JSON.stringify(habitsBefore));

  // Delete a routine with undo
  await p.click('.routine-remove[data-series="gym"]'); await p.waitForTimeout(150);
  check('Deleting a routine removes all its days', !(await events(p)).some((e) => e.seriesId === 'gym'));
  await p.click('.undo-toast-btn'); await p.waitForTimeout(150);
  check('Undo brings it back', (await events(p)).some((e) => e.id === 'gym'));

  // A moved occurrence isn't listed as a separate one-time event
  await p.evaluate(() => { location.hash = '#/'; }); await p.waitForTimeout(100);
  await p.evaluate(() => { const ev = JSON.parse(localStorage.getItem('unmet_events')); ev.push({ id: 'ovr', seriesId: 'cls', title: 'Classes', type: 'once', date: '2026-11-01', start: '09:00', end: '11:00', source: 'manual' }); localStorage.setItem('unmet_events', JSON.stringify(ev)); location.hash = '#/calendar'; });
  await p.waitForTimeout(250);
  const onceTitles = await p.$$eval('.event-edit', (bs) => bs.map((b) => b.closest('.manage-row').querySelector('.mr-title').textContent.trim()));
  check('One-time list excludes moved routine occurrences', !onceTitles.includes('Classes') && onceTitles.includes('Dentist'), onceTitles.join(','));

  // Tapping an event in the Overview opens it; a habit opens its editor on Home
  await p.click('.agenda-item.event >> nth=0'); await p.waitForTimeout(200);
  check('Tapping an event opens its edit sheet', (await p.locator('#eventEditForm').count()) === 1);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  check('Escape closes the sheet', (await p.locator('#eventEditForm').count()) === 0);
  await p.click('.agenda-item.habit >> nth=0'); await p.waitForTimeout(300);
  check('Tapping a habit opens it on Home', (await p.evaluate(() => location.hash)) === '#/' && (await p.locator('#editForm').count()) === 1);
  await ctx.close();
}

// Wide screens keep the hour grid by default
{
  const { ctx, p } = await open('en', 1100);
  check('Desktop: first visit opens Day view', await p.getAttribute('#viewToggle [data-val="day"]', 'aria-checked') === 'true');
  await ctx.close();
}

// Arabic plain-language entry
{
  const { ctx, p } = await open('ar');
  await p.click('#addMenuBtn'); await p.waitForTimeout(120);
  await p.fill('#nlInput', 'محاضرات كل أحد وثلاثاء من 8 إلى 11 صباحًا');
  await p.click('#nlForm button[type=submit]'); await p.waitForTimeout(200);
  const prev = (await p.locator('.nl-preview').textContent()).replace(/\s+/g, ' ');
  check('Arabic: preview reads days and morning times', prev.includes('محاضرات') && prev.includes('08:00–11:00') && prev.includes('أحد، ثلاثاء'), prev.slice(0, 160));
  check('Arabic: page is right-to-left', (await p.evaluate(() => document.documentElement.dir)) === 'rtl');
  await ctx.close();
}

// Hostile text never runs as markup (Overview, routine list, edit sheet, plain-language preview)
{
  const { ctx, p } = await open();
  const bad = '<img src=x onerror="window.__pwned=1">';
  await p.evaluate((bad) => {
    const ev = JSON.parse(localStorage.getItem('unmet_events'));
    ev.forEach((e) => { if (e.seriesId === 'cls' || e.id === 'dent') e.title = bad; });
    localStorage.setItem('unmet_events', JSON.stringify(ev));
    location.hash = '#/'; setTimeout(() => { location.hash = '#/calendar'; }, 50);
  }, bad);
  await p.waitForTimeout(400);
  await p.locator('.routine-edit').first().click(); await p.waitForTimeout(150);
  await p.keyboard.press('Escape');
  await p.click('#addMenuBtn'); await p.fill('#nlInput', `${bad} every Monday 9-10am`);
  await p.click('#nlForm button[type=submit]'); await p.waitForTimeout(200);
  check('Hostile titles are shown as text, never run', !(await p.evaluate(() => window.__pwned)) && (await p.locator('#page-root img').count()) === 0);
  await ctx.close();
}

check('No page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
