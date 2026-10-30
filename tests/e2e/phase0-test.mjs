import { createRequire } from 'module';
const require = createRequire('/opt/node-tools/node_modules/dummy.js');
const { chromium } = require('playwright');

const OUT = process.env.E2E_OUT || '/tmp/unmet-e2e-shots';
import('fs').then((fs) => fs.mkdirSync(OUT, { recursive: true }));
const BASE = 'http://localhost:8090/seed.html';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const errors = [];
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
async function newPage(vp) {
  const p = await (await browser.newContext({ viewport: vp, hasTouch: vp.width < 500 })).newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => { errors.push('unexpected dialog: ' + d.message()); d.dismiss(); });
  return p;
}
const store = (p, k) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), k);

// ---- Bug 1: Week view alignment (desktop, phone, Arabic RTL) ----
for (const [label, vp, lang] of [['desktop', { width: 1440, height: 900 }, 'en'], ['phone', { width: 390, height: 844 }, 'en'], ['phone RTL', { width: 390, height: 844 }, 'ar']]) {
  const p = await newPage(vp);
  await p.goto(`${BASE}?r=calendar&view=week&theme=dark&lang=${lang}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(250);
  const r = await p.evaluate(() => {
    const labels = [...document.querySelectorAll('.week-hour-gutter .hour-label')];
    const centre = (h) => { const b = labels.find((l) => l.textContent.trim() === String(h)).getBoundingClientRect(); return b.top + b.height / 2; };
    const out = [];
    for (const b of document.querySelectorAll('.week-day-col-body .grid-block.event')) {
      const time = b.querySelector('.gb-time')?.textContent.trim().slice(0, 5);
      if (!time || !time.endsWith(':00')) continue;
      out.push({ title: b.querySelector('.gb-title').textContent.trim(), time, off: Math.round(b.getBoundingClientRect().top - centre(Number(time.slice(0, 2)))) });
    }
    return out;
  });
  const worst = Math.max(...r.map((x) => Math.abs(x.off)));
  check(`Week view blocks sit on their hour line (${label})`, r.length > 0 && worst <= 1, `${r.length} on-the-hour blocks checked, worst offset ${worst}px`);
  // sticky hour gutter still pinned after horizontal scroll
  const pinned = await p.evaluate(() => {
    const sc = document.querySelector('.week-grid-scroll');
    const g = document.querySelector('.week-hour-gutter');
    const before = g.getBoundingClientRect().left;
    sc.scrollLeft = document.documentElement.dir === 'rtl' ? -300 : 300;
    return { scrolled: sc.scrollLeft !== 0, moved: Math.round(g.getBoundingClientRect().left - before) };
  });
  if (vp.width < 500) check(`Hour gutter stays pinned when scrolling days sideways (${label})`, pinned.scrolled && pinned.moved === 0, JSON.stringify(pinned));
  await p.screenshot({ path: `${OUT}/week-${label.replace(' ', '-')}.png` });
  await p.close();
}

// ---- Bug 2: first routine -> success card visible on phone ----
{
  const p = await newPage({ width: 390, height: 844 });
  await p.goto(`${BASE}?r=calendar&view=day&theme=dark&empty=1`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(250);
  await p.click('#addRoutineBtn');
  await p.waitForTimeout(400);
  await p.fill('#evTitle', 'TEST Lab session');
  await p.click('#eventForm .weekday-chip[data-day="1"]');
  await p.click('#eventForm .weekday-chip[data-day="3"]');
  await p.fill('#evStart', '10:00');
  await p.fill('#evEnd', '11:30');
  await p.click('#eventForm button[type="submit"]');
  await p.waitForTimeout(900); // smooth scroll
  const vis = await p.evaluate(() => {
    const b = document.querySelector('#goAddHabitBtn');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, focused: document.activeElement === b };
  });
  check('"Your routine is set!" Add Habit button is on screen after saving', !!vis && vis.top >= 0 && vis.bottom <= vis.vh - 70, JSON.stringify(vis));
  check('Add Habit button has keyboard focus', !!vis && vis.focused);
  await p.screenshot({ path: `${OUT}/routine-success-phone.png` });
  await p.click('#goAddHabitBtn');
  await p.waitForTimeout(400);
  const pre = await p.evaluate(() => document.querySelector('[data-when="routine"]')?.getAttribute('aria-checked') === 'true' && document.querySelectorAll('.series-select-all:checked').length === 1);
  check('Add Habit still opens the habit form stacked on the new routine', pre === true);
  await p.close();
}

// ---- Bug 3: habit delete -> undo restores the exact record ----
{
  const p = await newPage({ width: 390, height: 844 });
  await p.goto(`${BASE}?r=&theme=dark`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  // Test data only: add three every-day habits so several rows show on today's (Saturday) list.
  await p.evaluate(() => {
    const hs = JSON.parse(localStorage.getItem('unmet_habits'));
    for (const id of ['tA', 'tB', 'tC']) hs.push({ id, name: 'TEST ' + id, scheduleType: 'independent', time: '', duration: 15, history: { '2026-10-23': true }, createdAt: '2026-10-01' });
    localStorage.setItem('unmet_habits', JSON.stringify(hs));
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  const before = await store(p, 'unmet_habits');
  const target = before.find((h) => h.id === 'h2');
  const idx = before.findIndex((h) => h.id === 'h2');
  await p.click('.habit-edit-trigger[data-id=\"h2\"]'); await p.click('#deleteHabitBtn');
  await p.waitForTimeout(150);
  const afterDelete = await store(p, 'unmet_habits');
  const toastText = await p.locator('.undo-toast').textContent().catch(() => null);
  check('Delete removes the habit and shows an Undo snackbar', afterDelete.length === before.length - 1 && !!toastText, `toast: "${toastText}"`);
  const tb = await p.locator('.undo-toast-btn').boundingBox();
  const nav = await p.locator('#bottomNav').boundingBox();
  check('Undo button is a 44px target and clears the bottom nav', tb.height >= 44 && tb.y + tb.height <= nav.y, `btn h=${Math.round(tb.height)}, bottom=${Math.round(tb.y + tb.height)}, nav top=${Math.round(nav.y)}`);
  await p.screenshot({ path: `${OUT}/undo-toast-phone.png` });
  await p.click('.undo-toast-btn');
  await p.waitForTimeout(150);
  const restored = await store(p, 'unmet_habits');
  check('Undo puts back the identical habit (history + stacking) in the same position',
    JSON.stringify(restored[idx]) === JSON.stringify(target) && restored.length === before.length,
    `${Object.keys(target.history).length} history days`);
  check('Restored habit shows in today\'s list again', (await p.locator('.habit-check[data-id="h2"]').count()) === 1);
  check('Snackbar closes after Undo', (await p.locator('.undo-toast').count()) === 0);

  // auto-dismiss: delete stays deleted
  await p.click('.habit-edit-trigger[data-id=\"tA\"]'); await p.click('#deleteHabitBtn');
  await p.waitForTimeout(6400);
  check('Snackbar auto-dismisses after ~6s and the delete stands', (await p.locator('.undo-toast').count()) === 0 && !(await store(p, 'unmet_habits')).some((h) => h.id === 'tA'));

  // navigating away dismisses it
  await p.click('.habit-edit-trigger[data-id=\"tB\"]'); await p.click('#deleteHabitBtn');
  await p.waitForTimeout(100);
  await p.evaluate(() => { location.hash = '#/calendar'; });
  await p.waitForTimeout(200);
  check('Snackbar is dismissed on navigation', (await p.locator('.undo-toast').count()) === 0);

  // a second delete replaces the first toast; undo restores only the latest
  await p.evaluate(() => { location.hash = '#/'; });
  await p.waitForTimeout(200);
  const n0 = (await store(p, 'unmet_habits')).length;
  await p.click('.habit-edit-trigger[data-id=\"tC\"]'); await p.click('#deleteHabitBtn');
  await p.waitForTimeout(100);
  await p.click('.habit-edit-trigger[data-id=\"h2\"]'); await p.click('#deleteHabitBtn');
  await p.waitForTimeout(100);
  check('Only one snackbar at a time', (await p.locator('.undo-toast').count()) === 1);
  await p.click('.undo-toast-btn');
  await p.waitForTimeout(100);
  const ids = (await store(p, 'unmet_habits')).map((h) => h.id);
  check('Undo after two deletes restores only the most recent', ids.includes('h2') && !ids.includes('tC') && ids.length === n0 - 1, ids.join(','));
  await p.close();
}

// ---- Bug 4: subtitle copy ----
for (const [lang, expected] of [['en', 'Your routines and habits, hour by hour'], ['ar', 'روتينك وعاداتك، ساعة بساعة']]) {
  const p = await newPage({ width: 390, height: 844 });
  await p.goto(`${BASE}?r=calendar&theme=dark&lang=${lang}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(200);
  const sub = (await p.locator('.screen-subtitle').first().textContent()).trim();
  check(`Calendar subtitle (${lang})`, sub === expected, sub);
  await p.close();
}

console.log(`\n${pass} passed, ${fail} failed; page errors: ${JSON.stringify(errors)}`);
await browser.close();
