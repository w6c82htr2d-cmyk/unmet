// Phase 5: habit patterns on Home and the Insights page — real counts, confirm before changing,
// undo, dismiss, honest "not enough history".
import { createRequire } from 'module';
const require = createRequire('/opt/node-tools/node_modules/dummy.js');
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
let pass = 0, fail = 0; const errors = [];
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

async function open(lang, habitsFn) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Riyadh' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.clock.setFixedTime(new Date('2026-10-28T12:00:00+03:00')); // Wednesday
  await p.goto(`http://localhost:8090/seed.html?r=&theme=dark&lang=${lang}`, { waitUntil: 'networkidle' });
  await p.evaluate(habitsFn);
  await p.evaluate(() => localStorage.setItem('unmet_recap_seen', '2026-10-18')); // the weekly recap card has priority until opened
  await p.evaluate(() => { location.hash = '#/insight'; }); await p.waitForTimeout(100);
  await p.evaluate(() => { location.hash = '#/'; }); await p.waitForTimeout(300);
  return { ctx, p };
}
// "Stretch": every day except Mondays (never), for 40 days; plus a steady "Read".
const seedPattern = () => {
  const d = (o) => { const x = new Date(); x.setDate(x.getDate() + o); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  const s = {}; const r = {};
  for (let i = 1; i <= 40; i++) { const day = d(-i); if (new Date(day + 'T12:00:00').getDay() !== 1) s[day] = true; r[day] = true; }
  localStorage.setItem('unmet_habits', JSON.stringify([
    { id: 'hs', name: 'Stretch', scheduleType: 'independent', time: '07:00', duration: 15, createdAt: d(-45), history: s },
    { id: 'hr', name: 'Read', scheduleType: 'independent', time: '21:00', duration: 20, createdAt: d(-45), history: r },
  ]));
  localStorage.removeItem('unmet_evening'); localStorage.removeItem('unmet_morning');
};
const habits = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('unmet_habits')));

{
  const { ctx, p } = await open('en', seedPattern);
  const card = (await p.locator('.insight-card').first().textContent()).replace(/\s+/g, ' ');
  check('Home shows the strongest pattern with real counts', card.includes('Mondays look different') && card.includes('“Stretch” was done on 0 of the last 4 Mondays, and on 24 of 24 other scheduled days'), card.slice(0, 200));
  check('Wording offers options, no reasons or judgement', /or keep it as it is/.test(card) && !/because|lazy|fail|should/i.test(card));
  await p.click('.pat-action'); await p.waitForTimeout(150);
  check('Suggested change asks for confirmation first', (await p.locator('.insight-confirm').textContent()).includes('will no longer be scheduled on Mondays') && JSON.stringify((await habits(p))[0].days) === undefined);
  check('Confirm button gets focus', (await p.evaluate(() => document.activeElement?.className)).includes('pat-confirm'));
  await p.click('.pat-cancel'); await p.waitForTimeout(120);
  check('Cancel changes nothing', !(await habits(p))[0].days && (await p.locator('.insight-confirm').count()) === 0);
  await p.click('.pat-action'); await p.click('.pat-confirm'); await p.waitForTimeout(200);
  const after = (await habits(p))[0];
  check('Confirmed: Stretch now skips Mondays only; history untouched', JSON.stringify(after.days) === '[0,2,3,4,5,6]' && Object.keys(after.history).length === 34);
  check('Undo offered', (await p.locator('.undo-toast').textContent()).includes('Updated: Stretch'));
  await p.click('.undo-toast-btn'); await p.waitForTimeout(150);
  check('Undo restores every day', !(await habits(p))[0].days);
  check('Applied insight does not come straight back', !(await p.locator('#page-root').textContent()).includes('Mondays look different'));

  // Insights page
  await p.evaluate(() => { localStorage.removeItem('unmet_insights_dismissed'); location.hash = '#/insight'; }); await p.waitForTimeout(250);
  const titles = await p.$$eval('.insight-head', (h) => h.map((x) => x.textContent));
  check('Insights page lists every pattern', titles.includes('Mondays look different') && titles.includes('“Read” is steady'), titles.join(' | '));
  await p.locator('.insight-card', { hasText: 'is steady' }).locator('.pat-dismiss').click(); await p.waitForTimeout(150);
  check('Dismissing removes it from the list', !(await p.locator('#page-root').textContent()).includes('is steady'));
  await p.evaluate(() => { location.hash = '#/'; }); await p.waitForTimeout(200);
  await p.click('.pat-dismiss'); await p.waitForTimeout(150);
  check('"Not now" on Home hides it', !(await p.locator('#page-root').textContent()).includes('Mondays look different'));
  await ctx.close();
}

// Not enough history
{
  const { ctx, p } = await open('en', () => {
    const d = new Date(); d.setDate(d.getDate() - 5); const c = d.toISOString().slice(0, 10);
    localStorage.setItem('unmet_habits', JSON.stringify([{ id: 'n', name: 'New', scheduleType: 'independent', time: '07:00', duration: 10, createdAt: c, history: {} }]));
    localStorage.removeItem('unmet_evening'); localStorage.removeItem('unmet_morning');
  });
  check('No pattern card on Home with little history', (await p.locator('[data-pattern]').count()) === 0);
  await p.evaluate(() => { location.hash = '#/insight'; }); await p.waitForTimeout(200);
  const body = (await p.locator('.empty-state').textContent()).replace(/\s+/g, ' ');
  check('Insights page says honestly how much history exists', body.includes('Not enough history yet') && /So far: [45]\b/.test(body), body);
  await ctx.close();
}

// Arabic
{
  const { ctx, p } = await open('ar', seedPattern);
  const card = (await p.locator('.insight-card').first().textContent()).replace(/\s+/g, ' ');
  check('Arabic pattern text with weekday name', card.includes('الاثنين') && card.includes('«Stretch»') && card.includes('0 من آخر 4'), card.slice(0, 160));
  await ctx.close();
}

// Hostile habit names are text
{
  const { ctx, p } = await open('en', () => {
    const d = (o) => { const x = new Date(); x.setDate(x.getDate() + o); return x.toISOString().slice(0, 10); };
    const s = {}; for (let i = 1; i <= 40; i++) { const day = d(-i); if (new Date(day + 'T12:00:00').getDay() !== 1) s[day] = true; }
    localStorage.setItem('unmet_habits', JSON.stringify([{ id: 'x', name: '<img src=x onerror="window.__pwned=1">', scheduleType: 'independent', time: '07:00', duration: 15, createdAt: d(-45), history: s }]));
  });
  await p.click('.pat-action').catch(() => {}); await p.waitForTimeout(150);
  check('Habit names in insights never run as markup', !(await p.evaluate(() => window.__pwned)) && (await p.locator('.insight-card img').count()) === 0 && (await p.locator('.insight-card').count()) > 0);
  await ctx.close();
}

check('No page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
