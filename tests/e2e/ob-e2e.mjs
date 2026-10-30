// Phase 4: onboarding — routine first (school/university/work recommended, optional), then one
// small habit stacked on it, summary of what was set up, no duplicate saves on Back.
import { createRequire } from 'module';
const require = createRequire('/opt/node-tools/node_modules/dummy.js');
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
let pass = 0, fail = 0; const errors = [];
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const today = '2026-10-27';

async function fresh(lang = 'en', setup) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Riyadh' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.clock.setFixedTime(new Date('2026-10-27T18:00:00+03:00')); // Tuesday evening
  await p.goto('http://localhost:8090/favicon.svg');
  await p.evaluate(({ lang, setup }) => { localStorage.clear(); localStorage.setItem('unmet_lang', lang); if (setup) Object.entries(setup).forEach(([k, v]) => localStorage.setItem(k, v)); }, { lang, setup });
  await p.goto('http://localhost:8090/index.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  return { ctx, p };
}
const read = (p, k) => p.evaluate((k) => JSON.parse(localStorage.getItem(k)), k);
const next = async (p) => { await p.click('#nextBtn'); await p.waitForTimeout(150); };

// ---- Full path: University → Review notes after Classes ----
{
  const { ctx, p } = await fresh();
  await p.fill('#nameInput', 'Sam'); await next(p);
  await p.click('#obBack'); await p.waitForTimeout(120);
  check('Back keeps what was typed', (await p.inputValue('#nameInput')) === 'Sam');
  await next(p); await next(p);
  await p.click('.goal-track-card[data-id="gpa"]'); await next(p);
  const kinds = await p.$$eval('.ob-kind', (b) => b.map((x) => x.textContent.trim()));
  check('Routine step recommends School, University, Work first', kinds.slice(0, 3).join() === 'School,University,Work', kinds.join(','));
  check('Routine step is optional', (await p.locator('#skipBtn').textContent()).includes('skip'));
  await p.click('.ob-kind[data-kind="university"]'); await p.waitForTimeout(150);
  check('University prefills Classes, Mon–Fri, 09:00–12:00', (await p.inputValue('#obRoutineName')) === 'Classes' && (await p.$$eval('.ob-day[aria-pressed="true"]', (b) => b.map((x) => x.dataset.day).join())) === '1,2,3,4,5' && (await p.inputValue('#obStart')) === '09:00' && (await p.inputValue('#obEnd')) === '12:00');
  await p.fill('#obEnd', '08:00');
  await p.click('#saveRoutineBtn'); await p.waitForTimeout(150);
  check('Invalid times are explained, nothing saved', (await p.locator('.form-error').textContent()).includes('after the start') && !(await read(p, 'unmet_events')));
  await p.fill('#obEnd', '11:00');
  check('Duration shown while editing', (await p.locator('.dur-note').textContent()).includes('2 h'));
  await p.click('.ob-day[data-day="5"]'); await p.waitForTimeout(100);
  check('Edited values survive a day change', (await p.inputValue('#obEnd')) === '11:00');
  await p.click('#saveRoutineBtn'); await p.waitForTimeout(200);
  const ev = await read(p, 'unmet_events');
  check('Routine really saved: Mon–Thu 09:00–11:00, one series, from today', ev.length === 4 && new Set(ev.map((e) => e.seriesId)).size === 1 && ev.map((e) => e.dayOfWeek).join() === '1,2,3,4' && ev.every((e) => e.type === 'weekly' && e.start === '09:00' && e.end === '11:00' && e.startDate === today));

  // Habit step follows straight on
  check('Next step is a habit around the routine', (await p.locator('h2').textContent()).includes('around Classes'));
  check('Focus moves to the new step heading', (await p.evaluate(() => document.activeElement?.tagName)) === 'H2');
  const ideas = await p.$$eval('.ob-idea', (b) => b.map((x) => x.textContent.trim()));
  check('Ideas fit university + grades', ideas[0] === "Review today's notes" && ideas.includes('Write my own'), ideas.join(' | '));
  await p.click('.ob-idea >> nth=0'); await p.waitForTimeout(150);
  check('Idea fills the name and a sensible length', (await p.inputValue('#obHabitName')) === "Review today's notes" && (await p.getAttribute('[data-dur="15"]', 'aria-checked')) === 'true');
  check('Preview shows the next real slot (tomorrow, not earlier today)', (await p.locator('.ob-preview').textContent()).includes('Wednesday') && (await p.locator('.ob-preview').textContent()).includes('11:00–11:15'), await p.locator('.ob-preview').textContent());
  await p.click('[data-pos="before"]'); await p.waitForTimeout(100);
  check('Before/after updates the preview', (await p.locator('.ob-preview').textContent()).includes('08:45–09:00'));
  await p.click('[data-pos="after"]'); await p.waitForTimeout(100);
  await p.click('#saveHabitBtn'); await p.waitForTimeout(200);
  const hb = await read(p, 'unmet_habits');
  check('Habit saved stacked after all 4 routine days', hb.length === 1 && hb[0].scheduleType === 'stacked' && hb[0].stackEventIds.length === 4 && !hb[0].stackPosition && hb[0].duration === 15);
  const summary = (await p.locator('.ob-summary').textContent()).replace(/\s+/g, ' ');
  check('Done screen lists what was set up', summary.includes('Classes') && summary.includes('Mon, Tue, Wed, Thu') && summary.includes("Review today's notes") && summary.includes('After Classes'), summary);
  await p.click('#obBack').catch(() => {});
  check('Done screen has no Back (setup is complete)', (await p.locator('#obBack').count()) === 0);
  await p.click('#finishBtn'); await p.waitForTimeout(400);
  check('Lands on Home with the habit listed', (await p.locator('.habit-row', { hasText: "Review today's notes" }).count()) === 1 && (await read(p, 'unmet_profile')).onboarded === true);
  check('Profile keeps name and goals', JSON.stringify(await read(p, 'unmet_profile')) === JSON.stringify({ firstName: 'Sam', goalTracks: ['gpa'], onboarded: true }));
  await ctx.close();
}

// ---- Back after saving never saves twice ----
{
  const { ctx, p } = await fresh();
  await p.fill('#nameInput', 'Kim'); await next(p); await next(p); await next(p);
  await p.click('.ob-kind[data-kind="work"]'); await p.waitForTimeout(100);
  await p.click('#saveRoutineBtn'); await p.waitForTimeout(200);
  await p.click('#obBack'); await p.waitForTimeout(150);
  check('Back to routine step shows it as saved, no second form', (await p.locator('.ob-saved').textContent()).includes('Work') && (await p.locator('#saveRoutineBtn').count()) === 0);
  await next(p);
  await p.click('.ob-idea >> nth=0'); await p.click('#saveHabitBtn'); await p.waitForTimeout(200);
  await p.click('#obBack').catch(() => {});
  await p.goto('about:blank'); // leave mid-way
  await p.goto('http://localhost:8090/index.html', { waitUntil: 'networkidle' }); await p.waitForTimeout(300);
  await p.fill('#nameInput', 'Kim'); await next(p); await next(p); await next(p);
  check('Restarted onboarding sees existing routines instead of adding duplicates', (await p.locator('.ob-saved').textContent()).includes('already have') && (await p.locator('.ob-kind').count()) === 0);
  check('Still exactly one routine and one habit', (await read(p, 'unmet_events')).length === 5 && (await read(p, 'unmet_habits')).length === 1);
  await ctx.close();
}

// ---- No fixed schedule: own habit at a time ----
{
  const { ctx, p } = await fresh();
  await p.fill('#nameInput', 'Lee'); await next(p); await next(p); await next(p);
  await p.click('#skipBtn'); await p.waitForTimeout(150);
  check('Skipping the routine still offers a first habit', (await p.locator('h2').textContent()).includes('Pick one small habit') && !(await read(p, 'unmet_events')));
  await p.click('.ob-idea[data-idea="own"]'); await p.waitForTimeout(150);
  check('"Write my own" focuses an empty name', (await p.inputValue('#obHabitName')) === '' && (await p.evaluate(() => document.activeElement?.id)) === 'obHabitName');
  await p.click('#saveHabitBtn'); await p.waitForTimeout(150);
  check('Empty name explained', (await p.locator('.form-error').textContent()).includes('name'));
  await p.fill('#obHabitName', 'Journal one line'); await p.fill('#obHabitTime', '07:30'); await p.waitForTimeout(100);
  check('Time preview updates', (await p.locator('.ob-preview').textContent()).includes('07:30–07:40'));
  await p.click('#saveHabitBtn'); await p.waitForTimeout(200);
  const hb = await read(p, 'unmet_habits');
  check('Independent daily habit saved at 07:30', hb.length === 1 && hb[0].scheduleType === 'independent' && hb[0].time === '07:30' && !hb[0].days);
  await ctx.close();
}

// ---- Skip everything ----
{
  const { ctx, p } = await fresh();
  await p.fill('#nameInput', 'Ray'); await next(p); await next(p); await next(p);
  await p.click('#skipBtn'); await p.waitForTimeout(120); await p.click('#skipBtn'); await p.waitForTimeout(120);
  check('Skipping both is fine; done screen says what to do next', (await p.locator('.ob-summary').count()) === 0 && (await p.locator('.screen-subtitle').textContent()).includes('whenever'));
  await p.click('#finishBtn'); await p.waitForTimeout(300);
  check('Home shows the first-habit empty state', (await p.locator('#emptyAddBtn').count()) === 1);
  await ctx.close();
}

// ---- Arabic: the work week is Sunday–Thursday ----
{
  const { ctx, p } = await fresh('ar');
  await p.fill('#nameInput', 'سارة'); await next(p); await next(p); await next(p);
  await p.click('.ob-kind[data-kind="work"]'); await p.waitForTimeout(120);
  check('Arabic: Work defaults to Sun–Thu', (await p.$$eval('.ob-day[aria-pressed="true"]', (b) => b.map((x) => x.dataset.day).join())) === '0,1,2,3,4' && (await p.inputValue('#obRoutineName')) === 'العمل');
  check('Arabic: right-to-left', (await p.evaluate(() => document.documentElement.dir)) === 'rtl');
  await ctx.close();
}

check('No page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
