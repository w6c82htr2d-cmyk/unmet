import { t, getLang } from '../i18n.js';
import { icon } from '../icons.js';
import { getGoals, addGoal, removeGoal, restoreGoal, toggleSubtask, updateSubtask } from '../db.js';
import { showUndoToast } from '../lib/undoToast.js';
import { splitGoal, quadrant, findStalledSubtask } from '../lib/taskSplitter.js';
import { splitWithAI, CHALLENGES, getSplitPrefs, saveSplitPrefs } from '../lib/aiSplit.js';
import { micButtonHtml, wireMicButton, stopActiveDictation } from '../lib/speechToText.js';
import { requestAddHabit, requestAddEvent } from '../lib/pendingEdit.js';
import { navigate } from '../router.js';

let breaking = false;
let draftGoal = '';
let openConvertId = null;
let notice = null; // { goalId, kind: 'fallback' | 'limited' } after the latest split
let prefs = null;

export function renderTasks(root) {
  stopActiveDictation();
  if (!prefs) prefs = getSplitPrefs();
  const goals = getGoals();
  const personalized = prefs.challenges.length || prefs.note;

  root.innerHTML = `
    <div class="page tasks">
      <header>
        <h1 class="screen-title">${t('tasksTitle')}</h1>
        <div class="screen-subtitle">${t('tasksSubtitle')}</div>
      </header>

      <form id="goalForm" class="card strong col split-form" novalidate>
        <label class="label-sm" for="goalInput">${t('splitGoalLabel')}</label>
        <div class="row" style="gap:8px;">
          <input class="field grow" id="goalInput" placeholder="${escapeAttr(t('bigTaskPlaceholder'))}" value="${escapeAttr(draftGoal)}" maxlength="300" autocomplete="off" ${breaking ? 'disabled' : ''} />
          ${micButtonHtml('taskMic')}
        </div>
        <details class="split-personalize" ${personalized ? 'open' : ''}>
          <summary>${t('splitPersonalizeSummary')}</summary>
          <div class="label-sm" id="challengesLabel" style="margin:8px 0 6px;">${t('splitChallengesLabel')}</div>
          <div class="wrap-gap" role="group" aria-labelledby="challengesLabel">
            ${CHALLENGES.map((c) => `<button type="button" class="chip clickable challenge-chip ${prefs.challenges.includes(c) ? 'solid' : ''}" data-challenge="${c}" aria-pressed="${prefs.challenges.includes(c)}">${t(`splitCh_${c}`)}</button>`).join('')}
          </div>
          <label class="label-sm" for="splitNote" style="display:block; margin:10px 0 6px;">${t('splitNoteLabel')}</label>
          <input class="field" id="splitNote" value="${escapeAttr(prefs.note)}" maxlength="300" placeholder="${escapeAttr(t('splitNotePlaceholder'))}" autocomplete="off" />
          <p class="form-note" style="margin-top:6px;">${t('splitPrefsNote')}</p>
        </details>
        <button class="btn primary" type="submit" ${breaking ? 'disabled aria-busy="true"' : ''}>${breaking ? t('breakingDown') : t('breakDown')}</button>
        <p class="form-note">${t('splitPrivacyNote')}</p>
        <div class="sr-only" role="status" aria-live="polite">${breaking ? t('breakingDown') : ''}</div>
      </form>

      ${goals.length === 0 ? `
        <div class="empty-state card">
          <div class="icon-circle">${icon.tasks}</div>
          <div class="title">${t('noTasksYetTitle')}</div>
          <div class="body">${t('noTasksYetBody')}</div>
        </div>
      ` : `
        <div class="col">
          ${goals.map(goalCard).join('')}
        </div>
      `}
    </div>
  `;

  const goalInput = root.querySelector('#goalInput');
  wireMicButton(root, 'taskMic', goalInput);
  goalInput.addEventListener('input', () => { draftGoal = goalInput.value; });

  const savePrefsFromForm = () => {
    prefs.note = root.querySelector('#splitNote').value.trim();
    saveSplitPrefs(prefs);
  };
  root.querySelectorAll('.challenge-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const c = chip.dataset.challenge;
      prefs.challenges = prefs.challenges.includes(c) ? prefs.challenges.filter((x) => x !== c) : [...prefs.challenges, c];
      draftGoal = goalInput.value;
      savePrefsFromForm();
      renderTasks(root);
      root.querySelector(`.challenge-chip[data-challenge="${c}"]`)?.focus();
    });
  });
  root.querySelector('#splitNote').addEventListener('change', savePrefsFromForm);

  root.querySelector('#goalForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (breaking) return;
    const text = goalInput.value.trim();
    if (!text) { goalInput.focus(); return; }
    savePrefsFromForm();
    breaking = true;
    draftGoal = text;
    renderTasks(root);
    let subtasks;
    let source = 'ai';
    let kind = null;
    try {
      const steps = await splitWithAI({ goal: text, challenges: prefs.challenges, note: prefs.note, lang: getLang() });
      const now = new Date().toISOString();
      subtasks = steps.map((s, i) => ({ id: `st${i}`, text: s.text, minutes: s.minutes, importance: s.importance, urgency: s.urgency, kind: s.kind, done: false, lastTouched: now }));
    } catch (err) {
      // Never leave the user empty-handed: the local starter list still gives concrete steps.
      subtasks = splitGoal(text);
      source = 'template';
      kind = err.status === 429 ? 'limited' : 'fallback';
    }
    breaking = false;
    draftGoal = '';
    const goal = addGoal({ text, subtasks, source });
    notice = kind ? { goalId: goal.id, kind } : null;
    if (location.hash.replace(/^#/, '') !== '/tasks') return; // user moved on; the goal is saved
    renderTasks(root);
    root.querySelector('.goal-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  root.querySelectorAll('.subtask-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      toggleSubtask(btn.dataset.goal, btn.dataset.sub);
      renderTasks(root);
    });
  });

  root.querySelectorAll('.goal-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      const removed = removeGoal(btn.dataset.id);
      renderTasks(root);
      if (removed) {
        showUndoToast(t('goalRemovedToast'), t('undoBtn'), () => {
          restoreGoal(removed);
          renderTasks(root);
        });
      }
    });
  });

  root.querySelectorAll('.convert-trigger').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = `${btn.dataset.goal}:${btn.dataset.sub}`;
      openConvertId = openConvertId === key ? null : key;
      renderTasks(root);
      if (openConvertId) root.querySelector(`.convert-options[data-key="${key}"] button`)?.focus();
    });
  });

  const stepOf = (btn) => getGoals().find((g) => g.id === btn.dataset.goal)?.subtasks.find((s) => s.id === btn.dataset.sub);
  root.querySelectorAll('.convert-habit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = stepOf(btn);
      if (!s) return;
      updateSubtask(btn.dataset.goal, btn.dataset.sub, { convertedTo: 'habit' });
      openConvertId = null;
      // Opens the habit form with the name and length filled in; the user picks when.
      requestAddHabit([], { name: s.text, duration: s.minutes || 10 });
      navigate('/');
    });
  });
  root.querySelectorAll('.convert-event').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = stepOf(btn);
      if (!s) return;
      updateSubtask(btn.dataset.goal, btn.dataset.sub, { convertedTo: 'event' });
      openConvertId = null;
      requestAddEvent({ title: s.text, minutes: s.minutes || 30 });
      navigate('/calendar');
    });
  });
  root.querySelectorAll('.convert-task').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = stepOf(btn);
      if (!s) return;
      addGoal({ text: s.text, subtasks: [] });
      updateSubtask(btn.dataset.goal, btn.dataset.sub, { convertedTo: 'task' });
      openConvertId = null;
      renderTasks(root);
    });
  });
}

// The single best next action: the first not-done subtask, preferring the most urgent-and-important
// quadrant first so the user always sees one clear recommendation rather than an undifferentiated list.
function recommendedSubtaskId(goal) {
  const order = ['doNow', 'quickWin', 'schedule', 'dropLater'];
  for (const q of order) {
    const found = goal.subtasks.find((s) => !s.done && quadrant(s.importance, s.urgency) === q);
    if (found) return found.id;
  }
  return null;
}

function goalCard(goal) {
  const stalled = findStalledSubtask(goal);
  const recommendedId = recommendedSubtaskId(goal);
  const counts = { doNow: 0, schedule: 0, quickWin: 0, dropLater: 0 };
  goal.subtasks.forEach((s) => { counts[quadrant(s.importance, s.urgency)] += 1; });
  const note = notice && notice.goalId === goal.id ? notice.kind : null;

  return `
    <section class="card col goal-card" aria-label="${escapeAttr(goal.text)}">
      <div class="row between" style="align-items:flex-start;">
        <h2 class="goal-title">${escapeHtml(goal.text)}</h2>
        <button class="icon-btn goal-remove" data-id="${goal.id}" aria-label="${escapeAttr(t('removeGoal'))}: ${escapeAttr(goal.text)}">${icon.trash}</button>
      </div>
      ${goal.source === 'ai' ? `<div class="split-source">${icon.sparkle} ${t('splitSourceAi')}</div>` : ''}
      ${note ? `<div class="form-note split-fallback" role="status">${t(note === 'limited' ? 'splitLimitedNote' : 'splitFallbackNote')}</div>` : ''}

      ${stalled ? `
        <div class="card dashed" style="padding:10px 12px;">
          <div style="font-size:12px; font-weight:700; color:var(--accent); margin-bottom:2px;">${t('stalledNudgeTitle')}</div>
          <div style="font-size:12px;">${t('stalledNudgeBody', { step: escapeHtml(stalled.text) })}</div>
        </div>
      ` : ''}

      <div class="subtask-list">
        ${goal.subtasks.map((s) => subtaskRow(goal.id, s, s.id === recommendedId)).join('')}
      </div>

      <div>
        <div class="label-sm" style="margin-bottom:6px;">${t('matrixTitle')}</div>
        <div class="matrix-mini">
          <div class="mrow">
            <div class="mcell lo">${t('schedule')} (${counts.schedule})</div>
            <div class="mcell hi">${t('doNow')} (${counts.doNow})</div>
          </div>
          <div class="mrow">
            <div class="mcell lo">${t('dropLater')} (${counts.dropLater})</div>
            <div class="mcell lo">${t('quickWin')} (${counts.quickWin})</div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function subtaskRow(goalId, s, isRecommended) {
  const key = `${goalId}:${s.id}`;
  const isOpen = openConvertId === key;
  const converted = s.convertedTo;
  return `
    <div class="col" style="gap:0;">
      <div class="task-row card ${isRecommended && !s.done ? 'recommended' : ''}" style="padding:8px 10px; ${s.done ? 'opacity:.6;' : ''}">
        <button class="task-dot ${s.importance === 'hi' ? 'hi' : 'lo'} subtask-toggle" data-goal="${goalId}" data-sub="${s.id}" aria-pressed="${s.done ? 'true' : 'false'}" aria-label="${s.done ? t('markUndone') : t('markDone')}: ${escapeAttr(s.text)}" style="border:none; cursor:pointer;"></button>
        <div class="grow step-text">
          ${isRecommended && !s.done ? `<div class="label-sm" style="color:var(--accent); margin-bottom:2px;">${t('nextUpBadge')}</div>` : ''}
          <span class="step-label" style="${s.done ? 'text-decoration:line-through;' : ''}">${escapeHtml(s.text)}</span>
          <span class="step-meta">${s.minutes ? `${t('minutesShort', { n: s.minutes })} · ` : ''}${t(quadrant(s.importance, s.urgency))}${converted ? ` · ${t(`splitConverted_${converted}`)}` : ''}</span>
        </div>
        ${!s.done ? `<button class="icon-btn convert-trigger" data-goal="${goalId}" data-sub="${s.id}" aria-expanded="${isOpen}" aria-label="${escapeAttr(t('splitUseStep', { step: s.text }))}">${icon.plus}</button>` : ''}
      </div>
      ${isOpen ? `
        <div class="convert-options" data-key="${escapeAttr(key)}" role="group" aria-label="${escapeAttr(t('convertPrompt'))}">
          <button class="chip clickable convert-habit" data-goal="${goalId}" data-sub="${s.id}">${t('convertToHabit')}</button>
          <button class="chip clickable convert-event" data-goal="${goalId}" data-sub="${s.id}">${t('splitToCalendar')}</button>
          <button class="chip clickable convert-task" data-goal="${goalId}" data-sub="${s.id}">${t('convertToTask')}</button>
        </div>
      ` : ''}
    </div>
  `;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
