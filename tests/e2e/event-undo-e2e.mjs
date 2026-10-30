import { createRequire } from 'module';
const require = createRequire('/opt/node-tools/node_modules/dummy.js');
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
let pass = 0, fail = 0; const errors = [];
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Riyadh' })).newPage();
p.on('pageerror', (e) => errors.push(e.message));
p.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss(); });
await p.clock.setFixedTime(new Date('2026-10-25T09:00:00+03:00')); // Sunday: Classes day
await p.goto('http://localhost:8090/seed.html?r=calendar&view=day&theme=dark', { waitUntil: 'networkidle' });
await p.waitForTimeout(300);
const events = () => p.evaluate(() => localStorage.getItem('unmet_events'));
const original = await events();
const linked = () => p.evaluate(() => { const h = JSON.parse(localStorage.getItem('unmet_habits')).find((x) => x.id === 'h1'); const ev = JSON.parse(localStorage.getItem('unmet_events')); return h.stackEventIds.filter((id) => ev.some((e) => e.id === id)).length; });

for (const scope of ['occurrence', 'series']) {
  await p.locator('.grid-block.event', { hasText: 'Classes' }).first().click();
  await p.waitForTimeout(200);
  await p.check(`input[name="editScope"][value="${scope}"]`).catch(() => {});
  await p.waitForTimeout(100);
  await p.click('#deleteEventBtn');
  await p.waitForTimeout(200);
  const gone = (await p.locator('.grid-block.event', { hasText: 'Classes' }).count()) === 0;
  const toast = await p.locator('.undo-toast').textContent().catch(() => '');
  check(`Delete ${scope}: Classes disappears and Undo is offered`, gone && toast.includes('Removed from your calendar'), toast);
  if (scope === 'series') check('Deleting the series breaks the stacked habit links (before undo)', (await linked()) === 0);
  await p.click('.undo-toast-btn');
  await p.waitForTimeout(200);
  check(`Undo ${scope}: events restored byte-for-byte`, (await events()) === original);
  check(`Undo ${scope}: Classes block is back`, (await p.locator('.grid-block.event', { hasText: 'Classes' }).count()) === 1);
  check(`Undo ${scope}: stacked habit links restored`, (await linked()) === 3);
}
// From the "All events" list
await p.locator('.event-remove').first().click();
await p.waitForTimeout(200);
check('List delete offers Undo', (await p.locator('.undo-toast').count()) === 1);
await p.click('.undo-toast-btn'); await p.waitForTimeout(200);
check('List delete undo restores events', (await events()) === original);
// Without undo, delete stands after the toast closes
await p.locator('.event-remove').first().click();
await p.waitForTimeout(6500);
check('Without Undo the delete stands after 6s', (await events()) !== original && (await p.locator('.undo-toast').count()) === 0);
console.log(`\n${pass} passed, ${fail} failed; errors ${JSON.stringify(errors)}`);
await browser.close();
