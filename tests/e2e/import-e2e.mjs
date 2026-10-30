import { createRequire } from 'module';
const require = createRequire('/opt/node-tools/node_modules/dummy.js');
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
let pass = 0, fail = 0; const errors = [];
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true })).newPage();
p.on('pageerror', (e) => errors.push(e.message));
const dialogs = []; p.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
await p.goto('http://localhost:8090/seed.html?r=settings&theme=dark', { waitUntil: 'networkidle' });
await p.waitForTimeout(300);
const snapshot = () => p.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('unmet_') && k !== 'unmet_backup').sort().map((k) => [k, localStorage.getItem(k)]))));
const original = await snapshot();

// 1. Invalid file → message, nothing changed, no preview
await p.setInputFiles('#importFile', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"unmet_habits":"oops"}') });
await p.waitForTimeout(200);
check('Invalid file shows an error and changes nothing', (await p.locator('text=nothing was changed').count()) === 1 && (await snapshot()) === original && (await p.locator('#confirmImportBtn').count()) === 0);

// 2. Malicious-looking but valid file → preview, then cancel → unchanged
const incoming = { unmet_habits: [{ id: 'imp1', name: '<img src=x onerror=alert(1)>', scheduleType: 'independent', history: { '2026-10-01': true } }] };
await p.setInputFiles('#importFile', { name: '<b>evil</b>.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming)) });
await p.waitForTimeout(200);
const previewText = await p.locator('.import-preview').textContent();
check('Valid file shows a preview with both summaries', previewText.includes('1 habits') && previewText.includes('On this device now'), previewText.replace(/\s+/g, ' ').slice(0, 160));
check('File name is shown as text, not HTML', (await p.locator('.import-preview b').count()) === 0 && previewText.includes('<b>evil</b>.json'));
await p.click('#cancelImportBtn'); await p.waitForTimeout(150);
check('Cancel leaves data untouched', (await snapshot()) === original && (await p.locator('.import-preview').count()) === 0);

// 3. Confirm import → backup saved, habits replaced, journals kept
await p.setInputFiles('#importFile', { name: 'ok.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming)) });
await p.waitForTimeout(200);
await p.click('#confirmImportBtn');
await p.waitForLoadState('networkidle'); await p.waitForTimeout(300);
const after = await p.evaluate(() => ({ habits: JSON.parse(localStorage.getItem('unmet_habits')).map((h) => h.id), goals: JSON.parse(localStorage.getItem('unmet_goals') || '[]').length, backup: JSON.parse(localStorage.getItem('unmet_backup') || 'null') }));
check('Import replaced only the habits section', JSON.stringify(after.habits) === '["imp1"]' && after.goals === 1);
check('A backup of the previous data was saved first', after.backup?.reason === 'import' && after.backup.data.unmet_habits.length === 4);
const box = await p.locator('.backup-box').textContent().catch(() => '');
check('Backup box is shown with a summary', box.includes('before an import') && box.includes('4 habits'), box.replace(/\s+/g, ' ').slice(0, 120));
check('Imported HTML in a habit name did not execute', dialogs.length === 0);
// Home renders the hostile name as text
await p.evaluate(() => { location.hash = '#/'; }); await p.waitForTimeout(250);
check('Home shows the hostile habit name as plain text', (await p.locator('.habit-name', { hasText: '<img' }).count()) === 1 && (await p.locator('.habit-name img').count()) === 0);

// 4. Restore → exactly the original data, and restore can be swapped back
await p.evaluate(() => { location.hash = '#/settings'; }); await p.waitForTimeout(250);
await p.click('#restoreBackupBtn');
await p.waitForLoadState('networkidle'); await p.waitForTimeout(300);
check('Restore brings back the exact previous data', (await snapshot()) === original);
check('Restore asked for confirmation', dialogs.some((m) => m.includes('Replace the data on this device')));
const reason = await p.evaluate(() => JSON.parse(localStorage.getItem('unmet_backup')).reason);
check('The replaced data became the new backup (undoable)', reason === 'restore');

// 5. Download backup works
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#downloadBackupBtn')]);
check('Download backup produces a JSON file', /^unmet-backup-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
await p.screenshot({ path: '/tmp/unmet-settings-backup.png', fullPage: true });
console.log(`\n${pass} passed, ${fail} failed; errors ${JSON.stringify(errors)}`);
await browser.close();
