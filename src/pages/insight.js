import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { getHabits } from '../db.js';
import { detectPattern, patternSentence } from '../lib/patterns.js';
import { activeHabitPatterns, historyDays, MIN_HISTORY_DAYS } from '../lib/habitPatterns.js';
import { patternCardHtml, wirePatternCards } from '../lib/homeInsight.js';
import { navigate } from '../router.js';

// Insights: every pattern found in the user's own check-ins, with the counts behind it.
export function renderInsight(root) {
  const habits = getHabits();
  const patterns = activeHabitPatterns(habits);
  const journal = detectPattern();
  const have = historyDays(habits);
  const rerender = () => renderInsight(root);

  root.innerHTML = `
    <div class="page insights">
      <button class="back-row" id="backBtn">${icon.back} ${t('back')}</button>
      <header>
        <h1 class="screen-title">${t('insightsPageTitle')}</h1>
        <div class="screen-subtitle">${t('insightsPageSubtitle')}</div>
      </header>

      ${patterns.map(patternCardHtml).join('')}

      ${journal ? `
        <section class="card insight-card">
          <div class="insight-kicker">${t('insightJournalKicker')}</div>
          <p class="insight-text">${patternSentence(journal)}</p>
          <p class="insight-idea">${t('nextStepGeneric', { text: escapeHtml(journal.text) })}</p>
        </section>
      ` : ''}

      ${!patterns.length && !journal ? `
        <div class="empty-state card">
          <div class="icon-circle">${icon.sparkle}</div>
          <div class="title">${t(have < MIN_HISTORY_DAYS ? 'insightsNotYetTitle' : 'insightsNoneTitle')}</div>
          <div class="body">${have < MIN_HISTORY_DAYS
            ? t('insightsNotYetBody', { have, need: MIN_HISTORY_DAYS })
            : t('insightsNoneBody')}</div>
        </div>
      ` : ''}

      <p class="form-note">${t('insightsHowNote')}</p>
    </div>
  `;

  root.querySelector('#backBtn').addEventListener('click', () => navigate('/'));
  wirePatternCards(root, rerender, patterns);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
