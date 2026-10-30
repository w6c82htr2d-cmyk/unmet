// Draws the shareable finale of "Your Week, Unmet" as a PNG, entirely in the browser. It contains
// only the recap numbers (and habit names if the user turns that on) — never journal entries or
// calendar details. Nothing is uploaded: the image goes to the system share sheet or a download.
import { t, getLang } from '../i18n.js';

const W = 1080;
const H = 1350;

function colors() {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return { accent: v('--accent', '#7FA6D6'), on: v('--accent-text-on', '#122033') };
}

export function drawRecapImage(recap, { includeNames = false, range = '' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d');
  const ar = getLang() === 'ar';
  const head = ar ? "'Tajawal', sans-serif" : "'Space Grotesk', 'Inter', sans-serif";
  const body = ar ? "'Tajawal', sans-serif" : "'Inter', sans-serif";
  const { accent } = colors();

  // Deep blue background with a soft accent glow.
  c.fillStyle = '#0F1B2D';
  c.fillRect(0, 0, W, H);
  const g = c.createRadialGradient(W * 0.85, H * 0.1, 50, W * 0.85, H * 0.1, W);
  g.addColorStop(0, accent);
  g.addColorStop(1, 'rgba(15,27,45,0)');
  c.globalAlpha = 0.55;
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  c.globalAlpha = 1;

  c.direction = ar ? 'rtl' : 'ltr';
  c.textAlign = ar ? 'right' : 'left';
  const x = ar ? W - 90 : 90;
  c.fillStyle = '#FFFFFF';
  c.font = `700 40px ${head}`;
  c.fillText('UNMET', x, 140);
  c.font = `700 76px ${head}`;
  c.fillText(t('recapTitle'), x, 300);
  c.font = `500 40px ${body}`;
  c.fillStyle = '#C9D6E8';
  c.fillText(range, x, 370);

  c.fillStyle = '#FFFFFF';
  c.font = `700 300px ${head}`;
  c.direction = 'ltr';
  c.fillText(`${recap.pct}%`, ar ? W - 90 : 80, 690);
  c.direction = ar ? 'rtl' : 'ltr';
  c.font = `600 46px ${body}`;
  c.fillText(t('recapCheckins', { done: recap.done, total: recap.scheduled }), x, 780);

  const rows = [t('recapActiveDays', { n: recap.activeDays })];
  if (recap.streak) rows.push(includeNames ? t('recapStreakNamed', { n: recap.streak.days, name: recap.streak.name }) : t('recapStreak', { n: recap.streak.days }));
  if (recap.comebacks.length) rows.push(t('recapComebacksCount', { n: recap.comebacks.length }));
  if (includeNames && recap.top[0]) rows.push(t('recapTopNamed', { name: recap.top[0].name, done: recap.top[0].done, total: recap.top[0].total }));
  c.font = `500 40px ${body}`;
  c.fillStyle = '#DDE6F2';
  rows.slice(0, 4).forEach((r, i) => c.fillText(clip(c, r, W - 180), x, 900 + i * 70));

  c.fillStyle = '#9FB3CC';
  c.font = `500 30px ${body}`;
  c.fillText(t('recapImageFooter'), x, H - 90);
  return canvas;
}

function clip(c, text, max) {
  if (c.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && c.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}

// Opens the share sheet where files can be shared (most phones); otherwise downloads the PNG.
export async function shareRecapImage(canvas, filename) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not create the image');
  const file = typeof File === 'function' ? new File([blob], filename, { type: 'image/png' }) : null;
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: t('recapTitle') });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}
