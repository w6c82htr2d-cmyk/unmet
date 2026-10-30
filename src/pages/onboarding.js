import { t, getLang, setLang } from '../i18n.js';
import { getTheme, setTheme } from '../theme.js';
import { saveProfile } from '../db.js';
import { icon } from '../icons.js';

const GOAL_TRACKS = [
  { id: 'gpa', label: 'goalGPA', icon: 'bookGoal' },
  { id: 'fitness', label: 'goalFitness', icon: 'dumbbell' },
  { id: 'language', label: 'goalLanguage', icon: 'language' },
  { id: 'wellness', label: 'goalWellness', icon: 'wellness' },
];

let step = 0;
let state = { firstName: '', goalTracks: [] };

export function renderOnboarding(onComplete) {
  step = 0;
  state = { firstName: '', goalTracks: [] };
  const app = document.getElementById('app');
  renderStep(app, onComplete);
}

function progressBar() {
  return `<div class="onboard-progress">${[0, 1, 2, 3, 4].map((i) => `<div class="seg ${i <= step ? 'on' : ''}"></div>`).join('')}</div>`;
}

function topControls() {
  const lang = getLang();
  const theme = getTheme();
  return `
    <div class="row between">
      <div class="toggle-pill" id="themeToggle">
        <button data-val="light" class="${theme === 'light' ? 'active' : ''}" aria-label="${t('modeLight')}" aria-pressed="${theme === 'light'}">${icon.sun}</button>
        <button data-val="dark" class="${theme === 'dark' ? 'active' : ''}" aria-label="${t('modeDark')}" aria-pressed="${theme === 'dark'}">${icon.moon}</button>
      </div>
      <div class="toggle-pill" id="langToggle">
        <button data-val="en" class="${lang === 'en' ? 'active' : ''}" aria-label="${t('english')}" aria-pressed="${lang === 'en'}">EN</button>
        <button data-val="ar" class="${lang === 'ar' ? 'active' : ''}" aria-label="${t('arabic')}" aria-pressed="${lang === 'ar'}">AR</button>
      </div>
    </div>
  `;
}

function wireTopControls(container, rerender) {
  container.querySelector('#themeToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    setTheme(btn.dataset.val);
    rerender();
  });
  container.querySelector('#langToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    setLang(btn.dataset.val);
    rerender();
  });
}

function renderStep(app, onComplete) {
  const rerender = () => renderStep(app, onComplete);

  if (step === 0) {
    app.innerHTML = `
      <div class="onboard-wrap">
        ${topControls()}
        ${progressBar()}
        <div style="flex:1"></div>
        <div class="center-text col" style="align-items:center;">
          <h1 class="screen-title font-head" style="font-size:26px;">${t('onboardWelcomeTitle')}</h1>
          <p class="screen-subtitle" style="max-width:340px;">${t('onboardWelcomeBody')}</p>
        </div>
        <div class="col" style="gap:8px;">
          <label class="label-sm">${t('namePrompt')}</label>
          <input class="field" id="nameInput" placeholder="${t('namePlaceholder')}" aria-label="${t('namePlaceholder')}" value="${escapeAttr(state.firstName)}" />
        </div>
        <div style="flex:1"></div>
        <button class="btn primary" id="nextBtn">${t('continueBtn')}</button>
      </div>
    `;
    wireTopControls(app, rerender);
    const input = app.querySelector('#nameInput');
    const next = () => {
      const val = input.value.trim();
      if (!val) { input.focus(); return; }
      state.firstName = val;
      step = 1;
      rerender();
    };
    app.querySelector('#nextBtn').addEventListener('click', next);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') next(); });
    return;
  }

  if (step === 1) {
    app.innerHTML = `
      <div class="onboard-wrap">
        ${progressBar()}
        <div style="flex:1"></div>
        <div class="center-text col" style="align-items:center;">
          <div class="insight-icon-wrap">${icon.lock}</div>
          <h1 class="screen-title font-head" style="font-size:22px;">${t('onboardHowTitle')}</h1>
        </div>
        <div class="card" style="font-size:13px; line-height:1.6;">${t('onboardHowBody')}</div>
        <div style="flex:1"></div>
        <button class="btn primary" id="nextBtn">${t('continueBtn')}</button>
      </div>
    `;
    app.querySelector('#nextBtn').addEventListener('click', () => { step = 2; rerender(); });
    return;
  }

  if (step === 2) {
    app.innerHTML = `
      <div class="onboard-wrap">
        ${progressBar()}
        <div>
          <h2 class="screen-title font-head">${t('onboardGoalTitle')}</h2>
          <p class="screen-subtitle">${t('onboardGoalBody')}</p>
        </div>
        <div class="goal-track-grid" id="goalGrid">
          ${GOAL_TRACKS.map((g) => `
            <button class="goal-track-card ${state.goalTracks.includes(g.id) ? 'selected' : ''}" data-id="${g.id}">
              <div class="icon-circle">${icon[g.icon]}</div>
              <div class="name">${t(g.label)}</div>
            </button>
          `).join('')}
        </div>
        <div style="flex:1"></div>
        <button class="btn primary" id="nextBtn">${t('continueBtn')}</button>
      </div>
    `;
    app.querySelectorAll('.goal-track-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        state.goalTracks = state.goalTracks.includes(id)
          ? state.goalTracks.filter((g) => g !== id)
          : [...state.goalTracks, id];
        rerender();
      });
    });
    app.querySelector('#nextBtn').addEventListener('click', () => { step = 3; rerender(); });
    return;
  }

  if (step === 3) {
    app.innerHTML = `
      <div class="onboard-wrap">
        ${progressBar()}
        <div>
          <h2 class="screen-title font-head">${t('onboardCalendarTitle')}</h2>
          <p class="screen-subtitle">${t('onboardCalendarBody')}</p>
        </div>
        <div class="col">
          <button class="btn secondary" id="manualBtn">${t('calendarManualOption')}</button>
        </div>
        <div style="flex:1"></div>
        <button class="btn ghost" id="skipBtn">${t('calendarSkip')}</button>
        <button class="btn primary" id="nextBtn">${t('continueBtn')}</button>
      </div>
    `;
    app.querySelector('#manualBtn').addEventListener('click', () => { step = 4; rerender(); });
    app.querySelector('#skipBtn').addEventListener('click', () => { step = 4; rerender(); });
    app.querySelector('#nextBtn').addEventListener('click', () => { step = 4; rerender(); });
    return;
  }

  // step 4 — done
  app.innerHTML = `
    <div class="onboard-wrap">
      ${progressBar()}
      <div style="flex:1"></div>
      <div class="center-text col" style="align-items:center;">
        <div class="insight-icon-wrap">${icon.check}</div>
        <h1 class="screen-title font-head" style="font-size:24px;">${t('onboardDoneTitle')}</h1>
        <p class="screen-subtitle">${t('onboardDoneBody')}</p>
      </div>
      <div style="flex:1"></div>
      <button class="btn primary" id="finishBtn">${t('startUsing')}</button>
    </div>
  `;
  app.querySelector('#finishBtn').addEventListener('click', () => {
    saveProfile({ firstName: state.firstName, goalTracks: state.goalTracks, onboarded: true });
    onComplete();
  });
}

function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
