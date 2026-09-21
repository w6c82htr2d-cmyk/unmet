import { t } from '../i18n.js';

const SEEN_KEY = 'unmet_tour_seen';

const STEPS = [
  { selector: '.nav-item[data-path="/"]', titleKey: 'tourHomeTitle', bodyKey: 'tourHomeBody' },
  { selector: '#addHabitToggle', titleKey: 'tourAddHabitTitle', bodyKey: 'tourAddHabitBody' },
  { selector: '.nav-item[data-path="/calendar"]', titleKey: 'tourCalendarTitle', bodyKey: 'tourCalendarBody' },
  { selector: '.nav-item[data-path="/journal"]', titleKey: 'tourJournalTitle', bodyKey: 'tourJournalBody' },
  { selector: '.nav-item[data-path="/tasks"]', titleKey: 'tourTasksTitle', bodyKey: 'tourTasksBody' },
  { selector: '.nav-item[data-path="/checkin"]', titleKey: 'tourCheckinTitle', bodyKey: 'tourCheckinBody' },
  { selector: '#helpBtn', titleKey: 'tourHelpTitle', bodyKey: 'tourHelpBody' },
];

let overlay = null;
let spot = null;
let tooltip = null;
let idx = 0;

export function hasTourBeenSeen() {
  return localStorage.getItem(SEEN_KEY) === '1';
}

export function startTour() {
  localStorage.setItem(SEEN_KEY, '1');
  idx = 0;
  buildOverlay();
  showStep();
}

export function endTour() {
  if (overlay) {
    overlay.remove();
    overlay = null;
    spot = null;
    tooltip = null;
  }
}

function buildOverlay() {
  endTour();
  overlay = document.createElement('div');
  overlay.className = 'tour-overlay';
  spot = document.createElement('div');
  spot.className = 'tour-spot';
  tooltip = document.createElement('div');
  tooltip.className = 'tour-tooltip';
  overlay.appendChild(spot);
  overlay.appendChild(tooltip);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) endTour();
  });
}

function showStep() {
  const step = STEPS[idx];
  const target = step && document.querySelector(step.selector);
  if (!step || !target) {
    if (idx < STEPS.length - 1) { idx += 1; showStep(); } else { endTour(); }
    return;
  }

  const rect = target.getBoundingClientRect();
  spot.style.top = `${rect.top - 6}px`;
  spot.style.left = `${rect.left - 6}px`;
  spot.style.width = `${rect.width + 12}px`;
  spot.style.height = `${rect.height + 12}px`;

  const isLast = idx === STEPS.length - 1;
  tooltip.innerHTML = `
    <div class="label-sm" dir="ltr">${idx + 1} / ${STEPS.length}</div>
    <div style="font-weight:700; font-size:13.5px; margin:2px 0 4px;">${t(step.titleKey)}</div>
    <div style="font-size:12px; color:var(--text-muted); line-height:1.5; margin-bottom:10px;">${t(step.bodyKey)}</div>
    <div class="row between">
      <button class="btn ghost sm" id="tourSkip">${t('tourSkip')}</button>
      <button class="btn primary sm" id="tourNext">${isLast ? t('tourDone') : t('tourNext')}</button>
    </div>
  `;
  positionTooltip(rect);

  tooltip.querySelector('#tourSkip').addEventListener('click', endTour);
  tooltip.querySelector('#tourNext').addEventListener('click', () => {
    if (isLast) { endTour(); return; }
    idx += 1;
    showStep();
  });
}

function positionTooltip(rect) {
  const tooltipWidth = 260;
  const above = rect.top > window.innerHeight / 2;
  if (above) {
    tooltip.style.top = `${rect.top - 12}px`;
    tooltip.style.transform = 'translateY(-100%)';
  } else {
    tooltip.style.top = `${rect.bottom + 12}px`;
    tooltip.style.transform = 'none';
  }
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - tooltipWidth / 2), window.innerWidth - tooltipWidth - 12);
  tooltip.style.left = `${left}px`;
}
