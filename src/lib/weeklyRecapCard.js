// Home card for "Your Week, Unmet": appears once the last finished week has enough check-ins and
// its recap hasn't been opened yet. "Later" hides it for this visit only.
import { t, getLang } from '../i18n.js';
import { getHabits, addDays } from '../db.js';
import { navigate } from '../router.js';
import { computeRecap, lastCompleteWeek, recapSeen } from './weeklyRecap.js';
import { dateForDisplay } from './dates.js';

let hiddenThisVisit = false;

export function weekRangeText(weekStart) {
  const f = (d) => dateForDisplay(d).toLocaleDateString(getLang() === 'ar' ? 'ar' : 'en-US', { month: 'short', day: 'numeric' });
  return `${f(weekStart)} – ${f(addDays(weekStart, 6))}`;
}

export function weekCardSlotHtml() {
  if (hiddenThisVisit) return '';
  const week = lastCompleteWeek();
  if (recapSeen(week)) return '';
  const recap = computeRecap(getHabits(), week);
  if (!recap.enough) return '';
  return `
    <section class="card recap-card" aria-labelledby="recapCardTitle">
      <div class="recap-card-kicker">${t('recapTitle')}</div>
      <h2 class="recap-card-title" id="recapCardTitle">${t('recapReadyTitle', { range: weekRangeText(week) })}</h2>
      <p class="recap-card-body">${t('recapReadyBody')}</p>
      <div class="row" style="gap:8px;">
        <button class="btn primary sm grow" id="openRecapBtn">${t('recapOpen')}</button>
        <button class="btn secondary sm grow" id="laterRecapBtn">${t('recapLater')}</button>
      </div>
    </section>
  `;
}

export function wireWeekCardSlot(root, rerender) {
  root.querySelector('#openRecapBtn')?.addEventListener('click', () => navigate('/week'));
  root.querySelector('#laterRecapBtn')?.addEventListener('click', () => { hiddenThisVisit = true; rerender(); });
}
