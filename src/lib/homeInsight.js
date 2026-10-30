// The single "one useful insight" slot at the bottom of Home. Kept separate from the page so the
// weekly recap card (Your Week, Unmet) and habit-pattern suggestions can plug in here.
import { t } from '../i18n.js';
import { detectPattern, patternSentence } from './patterns.js';
import { navigate } from '../router.js';

let dismissed = false;

export function homeInsightHtml() {
  if (dismissed) return '';
  const pattern = detectPattern();
  if (!pattern) return '';
  return `
    <section class="card insight-card">
      <div class="insight-kicker">${t('insightTitle')}</div>
      <p class="insight-text">${patternSentence(pattern)}</p>
      <div class="row" style="gap:8px;">
        <button class="btn primary sm grow" id="viewInsightBtn">${t('insightCta')}</button>
        <button class="btn secondary sm grow" id="dismissInsightBtn">${t('notNow')}</button>
      </div>
    </section>
  `;
}

export function wireHomeInsight(root, rerender) {
  root.querySelector('#viewInsightBtn')?.addEventListener('click', () => navigate('/insight'));
  root.querySelector('#dismissInsightBtn')?.addEventListener('click', () => { dismissed = true; rerender(); });
}
