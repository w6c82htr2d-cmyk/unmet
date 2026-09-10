import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { getGoals, addGoal, removeGoal, toggleSubtask } from '../db.js';
import { splitGoal, quadrant, findStalledSubtask } from '../lib/taskSplitter.js';

let breaking = false;

export function renderTasks(root) {
  const goals = getGoals();

  root.innerHTML = `
    <div class="page">
      <div>
        <h2 class="screen-title">${t('tasksTitle')}</h2>
        <div class="screen-subtitle">${t('tasksSubtitle')}</div>
      </div>

      <form id="goalForm" class="card strong col">
        <div class="label-sm">${t('bigTaskLabel')}</div>
        <div class="row" style="gap:8px;">
          <input class="field grow" id="goalInput" placeholder="${t('bigTaskPlaceholder')}" required />
          <button class="chip solid clickable" type="submit" style="white-space:nowrap;" ${breaking ? 'disabled' : ''}>${breaking ? t('breakingDown') : t('breakDown')}</button>
        </div>
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

  root.querySelector('#goalForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = root.querySelector('#goalInput');
    const text = input.value.trim();
    if (!text) return;
    addGoal({ text, subtasks: splitGoal(text) });
    renderTasks(root);
  });

  root.querySelectorAll('.subtask-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      toggleSubtask(btn.dataset.goal, btn.dataset.sub);
      renderTasks(root);
    });
  });

  root.querySelectorAll('.goal-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      removeGoal(btn.dataset.id);
      renderTasks(root);
    });
  });
}

function goalCard(goal) {
  const stalled = findStalledSubtask(goal);
  const counts = { doNow: 0, schedule: 0, quickWin: 0, dropLater: 0 };
  goal.subtasks.forEach((s) => { counts[quadrant(s.importance, s.urgency)] += 1; });

  return `
    <div class="card col">
      <div class="row between">
        <span style="font-weight:700; font-size:13px;">${escapeHtml(goal.text)}</span>
        <button class="chip clickable goal-remove" data-id="${goal.id}">${icon.trash}</button>
      </div>

      ${stalled ? `
        <div class="card dashed" style="padding:10px 12px;">
          <div style="font-size:11px; font-weight:700; color:var(--accent); margin-bottom:2px;">${t('stalledNudgeTitle')}</div>
          <div style="font-size:11px;">${t('stalledNudgeBody', { step: escapeHtml(stalled.text) })}</div>
        </div>
      ` : ''}

      <div class="subtask-list">
        ${goal.subtasks.map((s) => `
          <div class="task-row card" style="padding:8px 10px; ${s.done ? 'opacity:.6;' : ''}">
            <button class="task-dot ${s.importance === 'hi' ? 'hi' : 'lo'} subtask-toggle" data-goal="${goal.id}" data-sub="${s.id}" style="border:none; cursor:pointer;"></button>
            <span class="grow" style="font-size:11px; ${s.done ? 'text-decoration:line-through;' : ''}">${escapeHtml(s.text)}</span>
            <span class="chip ${s.importance === 'hi' && s.urgency === 'hi' ? 'accent' : ''}" style="font-size:9px; padding:3px 7px;">${t(quadrant(s.importance, s.urgency))}</span>
          </div>
        `).join('')}
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
    </div>
  `;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
