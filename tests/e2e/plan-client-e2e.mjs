import { createRequire } from 'module';
const require = createRequire('/opt/node-tools/node_modules/dummy.js');
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
for (const [status, body, expect] of [
  [429, { error: 'Too many', code: 'rate_limited' }, 'a lot of plans in a short time'],
  [502, { error: 'AI planning failed', code: 'upstream_error' }, 'temporarily unavailable'],
  [200, { goals: [{ id: 'g0', text: 'Learn French', importance: 'medium', urgency: 'low', firstStep: { type: 'stack', label: 'Practice after class' } }] }, 'Learn French'],
]) {
  const p = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await p.route('**/api/plan', (r) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }));
  await p.goto('http://localhost:8090/seed.html?r=journal/freeform&theme=dark', { waitUntil: 'networkidle' });
  await p.waitForTimeout(250);
  await p.fill('#brainDump', 'I want to learn French');
  await p.locator('button', { hasText: /plan/i }).last().click();
  await p.waitForTimeout(500);
  const text = await p.locator('#page-root').textContent();
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('unmet_freeform') || '[]').some((e) => e.text === 'I want to learn French'));
  check(`HTTP ${status}: page shows the right outcome`, text.includes(expect), expect);
  check(`HTTP ${status}: journal entry is saved either way`, saved);
  await p.context().close();
}
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
