import { createRequire } from 'module';
const require = createRequire('/opt/node-tools/node_modules/dummy.js');
const { chromium } = require('playwright');
const port = process.argv[2] || '8090';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const p = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
p.on('dialog', (d) => d.accept());
await p.goto(`http://localhost:${port}/seed.html?r=settings&theme=dark`, { waitUntil: 'networkidle' });
await p.waitForTimeout(300);
// A "shared template" file whose name field carries script.
const payload = { unmet_profile: { firstName: '<img src=x onerror="window.__pwned=1">', onboarded: true } };
await p.setInputFiles('#importFile', { name: 'template.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
await p.waitForTimeout(250);
if (await p.locator('#confirmImportBtn').count()) { await p.click('#confirmImportBtn'); await p.waitForLoadState('networkidle'); }
await p.waitForTimeout(300);
await p.evaluate(() => { location.hash = '#/'; });
await p.waitForTimeout(400);
console.log(`port ${port}: script executed =`, await p.evaluate(() => window.__pwned === 1));
// Round trip: export the seeded data and re-import it (new build only).
if (port === '8090') {
  await p.goto('http://localhost:8090/seed.html?r=settings&theme=dark', { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  const exported = await p.evaluate(() => JSON.stringify(Object.fromEntries(['unmet_profile','unmet_habits','unmet_events','unmet_morning','unmet_evening','unmet_freeform','unmet_goals','unmet_calendar_view'].filter((k) => localStorage.getItem(k)).map((k) => [k, JSON.parse(localStorage.getItem(k))]))));
  await p.setInputFiles('#importFile', { name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
  await p.waitForTimeout(250);
  console.log('own export re-imports (preview shown) =', (await p.locator('#confirmImportBtn').count()) === 1);
}
await browser.close();
