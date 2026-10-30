// Accessibility audit over every screen: small text, contrast, tap targets, unnamed controls.
import { createRequire } from 'module';
const require = createRequire('/opt/node-tools/node_modules/dummy.js');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 8090;
const SCREENS = ['', 'calendar&view=agenda', 'calendar&view=day', 'calendar&view=week', 'journal', 'journal/morning', 'journal/evening', 'journal/freeform', 'tasks', 'settings', 'help', 'insight'];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const totals = { smallText: 0, lowContrast: 0, smallTargets: 0, unnamed: 0, unlabeledInputs: 0 };
const samples = { smallText: new Map(), lowContrast: new Map(), smallTargets: new Map(), unnamed: new Map(), unlabeledInputs: new Map() };

async function audit(page, label) {
  const r = await page.evaluate(() => {
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(',').map((x) => parseFloat(x)); return { r, g, b, a }; };
    const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
    const bgOf = (el) => {
      const stack = [];
      for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) stack.push(c); if (c && c.a >= 1) break; }
      let bg = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
      for (let i = stack.length - 1; i >= 0; i--) bg = blend(stack[i], bg);
      return bg;
    };
    const visible = (el) => { const s = getComputedStyle(el); const b = el.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && b.width > 0 && b.height > 0 && parseFloat(s.opacity) > 0.05; };
    const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}"`;
    const out = { smallText: [], lowContrast: [], smallTargets: [], unnamed: [], unlabeledInputs: [] };
    const textEls = [...document.querySelectorAll('#app *')].filter((el) => visible(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
    for (const el of textEls) {
      const s = getComputedStyle(el);
      const size = parseFloat(s.fontSize);
      if (size < 11) out.smallText.push(`${desc(el)} ${size}px`);
      const fg = parse(s.color);
      if (!fg) continue;
      const bg = bgOf(el);
      const c = blend({ ...fg, a: fg.a * parseFloat(s.opacity) }, bg);
      const L1 = lum(c), L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const large = size >= 18.66 || (size >= 14 && parseInt(s.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) out.lowContrast.push(`${desc(el)} ${ratio.toFixed(2)}:1`);
    }
    const controls = [...document.querySelectorAll('#app button, #app a[href], #app input:not([type=hidden]), #app select, #app textarea, #app [role=button]')].filter(visible);
    for (const el of controls) {
      const b = el.getBoundingClientRect();
      const inline = el.tagName === 'INPUT' && (el.type === 'radio' || el.type === 'checkbox') && el.closest('label');
      const hit = el.dataset.hit ? parseFloat(el.dataset.hit) : 0;
      const after = getComputedStyle(el, '::after');
      const hitBox = after.content !== 'none' && after.position === 'absolute'
        ? { h: Math.max(b.height, parseFloat(after.height) || 0), w: Math.max(b.width, parseFloat(after.width) || 0) }
        : { h: b.height, w: b.width };
      const target = inline ? el.closest('label').getBoundingClientRect() : { height: hitBox.h, width: hitBox.w };
      if (target.height < 44 || target.width < 44) out.smallTargets.push(`${desc(el)} ${Math.round(target.width)}x${Math.round(target.height)}`);
      const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.getAttribute('placeholder') || '').trim()
        || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent.trim()) || el.closest('label')?.textContent.trim();
      if (!name) out.unnamed.push(desc(el));
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && !['radio', 'checkbox', 'file'].includes(el.type)) {
        const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.closest('label');
        if (!labelled) out.unlabeledInputs.push(desc(el));
      }
    }
    return out;
  });
  for (const k of Object.keys(totals)) {
    totals[k] += r[k].length;
    for (const s of r[k]) { const key = s.replace(/ [\d.]+(px|:1|x\d+)$/, ''); if (!samples[k].has(key)) samples[k].set(key, `${s}  [${label}]`); }
  }
}

for (const theme of ['dark', 'light']) {
  for (const lang of ['en', 'ar']) {
    if (lang === 'ar' && theme === 'light') continue;
    for (const s of SCREENS) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const p = await ctx.newPage();
      await p.goto(`http://localhost:${PORT}/seed.html?r=${s}&theme=${theme}&lang=${lang}`, { waitUntil: 'networkidle' });
      await p.waitForTimeout(250);
      await audit(p, `${s || 'home'} ${theme} ${lang}`);
      await ctx.close();
    }
  }
}
console.log('TOTAL (instances across screens):', JSON.stringify(totals));
const limit = Number(process.env.LIMIT || 12);
for (const k of Object.keys(samples)) {
  console.log(`\n## ${k}: ${samples[k].size} distinct`);
  [...samples[k].values()].slice(0, limit).forEach((s) => console.log('  ' + s));
}
await browser.close();
