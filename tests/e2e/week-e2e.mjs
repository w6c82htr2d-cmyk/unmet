// Phase 6: Your Week, Unmet — Home card, six slides from real data, share image, not-enough state.
import { createRequire } from 'module';
import { readFileSync } from 'fs';
const require = createRequire('/opt/node-tools/node_modules/dummy.js');
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
let pass = 0, fail = 0; const errors = [];
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

async function open(q = '', setup) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Riyadh', acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.clock.setFixedTime(new Date('2026-10-28T12:00:00+03:00')); // Wednesday
  await p.goto(`http://localhost:8090/seed.html?r=&theme=dark${q}`, { waitUntil: 'networkidle' });
  if (setup) { await p.evaluate(setup); await p.evaluate(() => { location.hash = '#/insight'; }); await p.waitForTimeout(100); await p.evaluate(() => { location.hash = '#/'; }); }
  await p.waitForTimeout(300);
  return { ctx, p };
}

// Expected numbers for Sun 18 – Sat 24 Oct computed independently from storage (independent
// habits every day or on their days; stacked ones on their routine days).
const expected = (p) => p.evaluate(() => {
  const habits = JSON.parse(localStorage.getItem('unmet_habits'));
  const events = JSON.parse(localStorage.getItem('unmet_events'));
  let done = 0, total = 0;
  for (let i = 0; i < 7; i++) {
    const d = `2026-10-${18 + i}`; const dow = i;
    habits.forEach((h) => {
      if (h.createdAt && d < h.createdAt) return;
      const sched = h.scheduleType === 'stacked'
        ? events.some((e) => h.stackEventIds.includes(e.id) && e.type === 'weekly' && e.dayOfWeek === dow && (!e.startDate || e.startDate <= d))
        : (!h.days || h.days.includes(dow));
      if (!sched) return;
      total += 1; if (h.history[d]) done += 1;
    });
  }
  return { done, total, pct: Math.round((done / total) * 100) };
});

{
  const { ctx, p } = await open();
  const card = (await p.locator('.recap-card').textContent().catch(() => '')).replace(/\s+/g, ' ');
  check('Home shows "Your Week, Unmet" for the finished week', card.includes('Your Week, Unmet') && card.includes('Oct 18 – Oct 24'), card);
  const exp = await expected(p);
  await p.click('#openRecapBtn'); await p.waitForTimeout(250);
  check('Opens the recap page', (await p.evaluate(() => location.hash)) === '#/week');
  const s1 = (await p.locator('.recap-slide').textContent()).replace(/\s+/g, ' ');
  check('Slide 1 numbers match the stored history exactly', s1.includes(`${exp.done} of ${exp.total} habit check-ins done`) && s1.includes(`${exp.pct}%`), `${JSON.stringify(exp)} | ${s1.slice(0, 160)}`);
  check('Six slides, first selected', (await p.locator('.recap-dot').count()) === 6 && (await p.getAttribute('.recap-dot >> nth=0', 'aria-selected')) === 'true');
  const kickers = [];
  for (let i = 0; i < 6; i++) {
    kickers.push((await p.locator('.recap-kicker').textContent()).trim().split('·')[0].trim());
    if (i < 5) { await p.click('#recapNext'); await p.waitForTimeout(150); }
  }
  check('Slides: overview, wins, patterns, comebacks, one thing to try, share', JSON.stringify(kickers) === JSON.stringify(['Your Week, Unmet', 'Wins', 'Patterns', 'Comeback moments', 'One thing to try', 'Share']), kickers.join(' | '));
  check('Focus moves to each slide title', (await p.evaluate(() => document.activeElement?.id)) === 'rs6');

  // Share image: numbers only by default
  check('Share card hides habit names by default', !(await p.locator('.recap-share-card').textContent()).match(/Review math|Read 20|Stretch|Walk home/));
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#recapShare')]);
  const path = await dl.path();
  const bytes = readFileSync(path);
  check('Share falls back to downloading a PNG where sharing files is unavailable', dl.suggestedFilename() === 'unmet-week-2026-10-18.png' && bytes.slice(1, 4).toString() === 'PNG' && bytes.length > 20000, `${dl.suggestedFilename()} ${bytes.length}`);
  await p.waitForTimeout(150);
  check('Status confirms the download', (await p.locator('.recap-note[role=status]').textContent()).includes('downloads'));
  await p.check('#includeNames'); await p.waitForTimeout(100);
  check('Turning names on is the user\'s choice', (await p.isChecked('#includeNames')));

  // Keyboard and dots
  await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(120);
  check('Arrow keys move between slides', (await p.getAttribute('.recap-dot >> nth=4', 'aria-selected')) === 'true');
  await p.click('.recap-dot >> nth=1'); await p.waitForTimeout(120);
  check('Dots jump to a slide', (await p.locator('.recap-kicker').textContent()).includes('Wins'));

  // Week navigation
  check('Next week disabled on the latest finished week', await p.isDisabled('#nextWeek'));
  await p.click('#prevWeek'); await p.waitForTimeout(200);
  check('Previous week opens its own recap', (await p.locator('.recap-range').textContent()).includes('Oct 11') && (await p.evaluate(() => location.hash)) === '#/week?w=2026-10-11');

  await p.evaluate(() => { location.hash = '#/'; }); await p.waitForTimeout(250);
  check('Home card is gone once the recap was opened', (await p.locator('.recap-card').count()) === 0);
  await ctx.close();
}

// "Later" hides the card for this visit only
{
  const { ctx, p } = await open();
  await p.click('#laterRecapBtn'); await p.waitForTimeout(150);
  check('"Later" hides the card', (await p.locator('.recap-card').count()) === 0);
  await ctx.close();
}

// Improvement with confirm + undo (Stretch skips Mondays → weekday pattern)
{
  const { ctx, p } = await open('', () => {
    const d = (o) => { const x = new Date(); x.setDate(x.getDate() + o); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
    const s = {}; for (let i = 1; i <= 40; i++) { const day = d(-i); if (new Date(day + 'T12:00:00').getDay() !== 1) s[day] = true; }
    localStorage.setItem('unmet_habits', JSON.stringify([{ id: 'hs', name: 'Stretch', scheduleType: 'independent', time: '07:00', duration: 15, createdAt: d(-45), history: s }]));
  });
  await p.evaluate(() => { location.hash = '#/week'; }); await p.waitForTimeout(250);
  await p.click('.recap-dot >> nth=4'); await p.waitForTimeout(150);
  check('One thing to try comes from the real pattern', (await p.locator('#rs5').textContent()).includes('Take Mondays off “Stretch”'));
  await p.click('#recapApply'); await p.waitForTimeout(120);
  check('It asks before changing anything', (await p.locator('.recap-confirm').textContent()).includes('no longer be scheduled on Mondays') && !(await p.evaluate(() => JSON.parse(localStorage.getItem('unmet_habits'))[0].days)));
  await p.click('#recapConfirm'); await p.waitForTimeout(150);
  check('Confirmed change applied', JSON.stringify(await p.evaluate(() => JSON.parse(localStorage.getItem('unmet_habits'))[0].days)) === '[0,2,3,4,5,6]');
  await p.click('.undo-toast-btn'); await p.waitForTimeout(120);
  check('Undo restores it', !(await p.evaluate(() => JSON.parse(localStorage.getItem('unmet_habits'))[0].days)));
  await ctx.close();
}

// Not enough history
{
  const { ctx, p } = await open('', () => {
    localStorage.setItem('unmet_habits', JSON.stringify([{ id: 'n', name: 'New', scheduleType: 'independent', time: '07:00', duration: 10, createdAt: '2026-10-23', history: { '2026-10-23': true } }]));
  });
  check('No recap card without enough history', (await p.locator('.recap-card').count()) === 0);
  await p.evaluate(() => { location.hash = '#/week'; }); await p.waitForTimeout(250);
  const t = (await p.locator('.recap-slide').textContent()).replace(/\s+/g, ' ');
  check('Recap says honestly there isn\'t enough, with the real count', t.includes('Not enough check-ins') && t.includes('This week had 2'), t);
  check('No slides or numbers shown', (await p.locator('.recap-dot').count()) === 0 && (await p.locator('.recap-number').count()) === 0);
  await ctx.close();
}

// Arabic: RTL, ArrowLeft goes forward
{
  const { ctx, p } = await open('&lang=ar');
  await p.evaluate(() => { location.hash = '#/week'; }); await p.waitForTimeout(250);
  check('Arabic title', (await p.locator('.recap-kicker').textContent()).includes('أسبوعك مع أنمِت'));
  await p.locator('.recap-page').press('ArrowLeft'); await p.waitForTimeout(120);
  check('Arabic: ArrowLeft moves forward', (await p.getAttribute('.recap-dot >> nth=1', 'aria-selected')) === 'true');
  await ctx.close();
}

// Hostile names stay text
{
  const { ctx, p } = await open('', () => {
    const h = JSON.parse(localStorage.getItem('unmet_habits')); h[1].name = '<img src=x onerror="window.__pwned=1">'; localStorage.setItem('unmet_habits', JSON.stringify(h));
  });
  await p.evaluate(() => { location.hash = '#/week'; }); await p.waitForTimeout(200);
  for (let i = 0; i < 5; i++) { await p.click('#recapNext'); await p.waitForTimeout(80); }
  await p.check('#includeNames'); await p.waitForTimeout(80);
  check('Habit names never run as markup in the recap', !(await p.evaluate(() => window.__pwned)) && (await p.locator('.recap-page img').count()) === 0);
  await ctx.close();
}

check('No page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
