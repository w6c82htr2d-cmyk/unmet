// Pattern cards: the one-insight slot at the bottom of Home and the full list on the Insights page.
// Wording states counts from the user's own history and offers practical options; it never
// explains *why*. A suggested change is applied only after the user confirms it, with Undo.
import { t, getLang } from '../i18n.js';
import { getHabits, updateHabit } from '../db.js';
import { navigate } from '../router.js';
import { activeHabitPatterns, dismissInsight } from './habitPatterns.js';
import { detectPattern, patternSentence } from './patterns.js';
import { requestHabitEdit } from './pendingEdit.js';
import { showUndoToast } from './undoToast.js';
import { weekCardSlotHtml, wireWeekCardSlot } from './weeklyRecapCard.js';

let confirming = null; // id of the pattern whose change is waiting for confirmation
let journalDismissed = false;

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Full weekday name (Sunday = 0), e.g. "Monday" / "الاثنين".
export function weekdayLong(dow) {
  const d = new Date(Date.UTC(2026, 9, 25 + dow, 12)); // 25 Oct 2026 is a Sunday
  return d.toLocaleDateString(getLang() === 'ar' ? 'ar' : 'en-US', { weekday: 'long', timeZone: 'UTC' });
}

export function patternText(p) {
  const name = escapeHtml(p.habitName);
  switch (p.type) {
    case 'weekday': return {
      title: t('patWeekdayTitle', { day: weekdayLong(p.dow) }),
      body: t('patWeekdayBody', { name, day: weekdayLong(p.dow), onDone: p.onDone, onTotal: p.onTotal, offDone: p.offDone, offTotal: p.offTotal }),
      idea: t(p.action.kind === 'skipDay' ? 'patWeekdayIdeaSkip' : 'patWeekdayIdeaEdit', { day: weekdayLong(p.dow) }),
    };
    case 'slide': return {
      title: t('patSlideTitle', { name }),
      body: t('patSlideBody', { recentDone: p.recentDone, recentTotal: p.recentTotal, beforeDone: p.beforeDone, beforeTotal: p.beforeTotal }),
      idea: p.action.kind === 'shorten' ? t('patSlideIdeaShorten', { minutes: p.action.minutes }) : t('patSlideIdeaEdit'),
    };
    case 'steady': return {
      title: t('patSteadyTitle', { name }),
      body: t('patSteadyBody', { done: p.done, total: p.total }),
      idea: '',
    };
    case 'linked': return {
      title: t('patLinkedTitle'),
      body: t('patLinkedBody', { linked: p.linkedPct, unlinked: p.unlinkedPct }),
      idea: t('patLinkedIdea', { name }),
    };
    default: return { title: '', body: '', idea: '' };
  }
}

function actionLabel(p) {
  if (!p.action) return '';
  if (p.action.kind === 'skipDay') return t('patActionSkip', { day: weekdayLong(p.action.dow) });
  if (p.action.kind === 'shorten') return t('patActionShorten', { minutes: p.action.minutes });
  return t('patActionEdit');
}

function confirmText(p) {
  const name = escapeHtml(p.habitName);
  if (p.action.kind === 'skipDay') return t('patConfirmSkip', { name, day: weekdayLong(p.action.dow) });
  const habit = getHabits().find((h) => h.id === p.habitId);
  return t('patConfirmShorten', { name, minutes: p.action.minutes, old: habit?.duration || '' });
}

export function patternCardHtml(p) {
  const txt = patternText(p);
  const needsConfirm = p.action && p.action.kind !== 'edit';
  const isConfirming = confirming === p.id;
  return `
    <section class="card insight-card" data-pattern="${escapeHtml(p.id)}">
      <div class="insight-kicker">${t('patKicker')}</div>
      <h3 class="insight-head">${txt.title}</h3>
      <p class="insight-text">${txt.body}</p>
      ${txt.idea ? `<p class="insight-idea">${txt.idea}</p>` : ''}
      ${isConfirming ? `
        <div class="insight-confirm" role="group" aria-label="${escapeHtml(t('patConfirmLabel'))}">
          <p class="insight-text">${confirmText(p)}</p>
          <div class="row" style="gap:8px;">
            <button class="btn primary sm grow pat-confirm" data-id="${escapeHtml(p.id)}">${t('patConfirmBtn')}</button>
            <button class="btn secondary sm grow pat-cancel">${t('cancel')}</button>
          </div>
        </div>
      ` : `
        <div class="row" style="gap:8px;">
          ${p.action ? `<button class="btn primary sm grow pat-action" data-id="${escapeHtml(p.id)}" data-confirm="${needsConfirm ? 1 : 0}">${actionLabel(p)}</button>` : ''}
          <button class="btn secondary sm grow pat-dismiss" data-id="${escapeHtml(p.id)}">${t(p.action ? 'notNow' : 'patDismissSteady')}</button>
        </div>
      `}
    </section>
  `;
}

export function wirePatternCards(root, rerender, patterns) {
  const byId = (id) => patterns.find((p) => p.id === id);
  root.querySelectorAll('.pat-dismiss').forEach((b) => b.addEventListener('click', () => {
    dismissInsight(b.dataset.id);
    confirming = null;
    rerender();
  }));
  root.querySelectorAll('.pat-action').forEach((b) => b.addEventListener('click', () => {
    const p = byId(b.dataset.id);
    if (!p) return;
    if (b.dataset.confirm === '1') {
      confirming = p.id;
      rerender();
      root.querySelector('.pat-confirm')?.focus();
      return;
    }
    requestHabitEdit(p.habitId);
    navigate('/');
  }));
  root.querySelector('.pat-cancel')?.addEventListener('click', () => { confirming = null; rerender(); });
  root.querySelector('.pat-confirm')?.addEventListener('click', (e) => {
    const p = byId(e.currentTarget.dataset.id);
    confirming = null;
    const habit = p && getHabits().find((h) => h.id === p.habitId);
    if (!habit) { rerender(); return; }
    const before = { days: habit.days, duration: habit.duration };
    if (p.action.kind === 'skipDay') {
      const base = habit.days && habit.days.length ? habit.days : [0, 1, 2, 3, 4, 5, 6];
      updateHabit(habit.id, { days: base.filter((d) => d !== p.action.dow) });
    } else if (p.action.kind === 'shorten') {
      updateHabit(habit.id, { duration: p.action.minutes });
    }
    dismissInsight(p.id);
    rerender();
    showUndoToast(t('patAppliedToast', { name: habit.name }), t('undoBtn'), () => {
      updateHabit(habit.id, before);
      rerender();
    });
  });
}

// ---- Home slot: Your Week card first (when a recap is ready), otherwise the strongest pattern ----
export function homeInsightHtml() {
  const week = weekCardSlotHtml();
  if (week) return week;
  const [top] = activeHabitPatterns(getHabits());
  if (top) return `${patternCardHtml(top)}<button class="btn ghost sm see-all-insights" id="seeAllInsightsBtn">${t('patSeeAll')}</button>`;
  if (journalDismissed) return '';
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
  wireWeekCardSlot(root, rerender);
  wirePatternCards(root, rerender, activeHabitPatterns(getHabits()));
  root.querySelector('#seeAllInsightsBtn')?.addEventListener('click', () => navigate('/insight'));
  root.querySelector('#viewInsightBtn')?.addEventListener('click', () => navigate('/insight'));
  root.querySelector('#dismissInsightBtn')?.addEventListener('click', () => { journalDismissed = true; rerender(); });
}
