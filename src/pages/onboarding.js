import { t, getLang, setLang } from '../i18n.js';
import { getTheme, setTheme } from '../theme.js';
import {
  saveProfile, getEvents, addEvents, addHabit, uid, todayStr, previewStackedOccurrences,
} from '../db.js';
import { icon } from '../icons.js';
import { weekdayKey } from '../lib/patterns.js';
import { dateForDisplay } from '../lib/dates.js';

const GOAL_TRACKS = [
  { id: 'gpa', label: 'goalGPA', icon: 'bookGoal' },
  { id: 'fitness', label: 'goalFitness', icon: 'dumbbell' },
  { id: 'language', label: 'goalLanguage', icon: 'language' },
  { id: 'wellness', label: 'goalWellness', icon: 'wellness' },
];

// Fixed schedules people most often have, recommended first. Every value is only a starting point
// the user edits before saving. The working/school week follows the language: Sun–Thu in Arabic.
const ROUTINE_KINDS = [
  { id: 'school', icon: 'school', label: 'obKindSchool', title: 'obTitleSchool', start: '07:30', end: '14:00' },
  { id: 'university', icon: 'university', label: 'obKindUniversity', title: 'obTitleUniversity', start: '09:00', end: '12:00' },
  { id: 'work', icon: 'briefcase', label: 'obKindWork', title: 'obTitleWork', start: '09:00', end: '17:00' },
  { id: 'other', icon: 'repeat', label: 'obKindOther', title: '', start: '', end: '' },
];

// First-habit ideas: small, concrete, and tied to what the user said they're working on.
const HABIT_IDEAS = {
  school: [['obIdeaReviewNotes', 15, 'after'], ['obIdeaPackBag', 5, 'after']],
  university: [['obIdeaReviewNotes', 15, 'after'], ['obIdeaPlanTomorrow', 10, 'after']],
  work: [['obIdeaWalk', 10, 'after'], ['obIdeaPlanTomorrow', 10, 'after']],
  other: [['obIdeaPlanTomorrow', 10, 'after']],
  gpa: [['obIdeaReviewNotes', 15, 'after']],
  fitness: [['obIdeaStretch', 10, 'after'], ['obIdeaWalk', 10, 'after']],
  language: [['obIdeaVocab', 10, 'after']],
  wellness: [['obIdeaBreathe', 5, 'before']],
  none: [['obIdeaRead', 15, 'after'], ['obIdeaPlanTomorrow', 10, 'after']],
};
const DURATIONS = [5, 10, 15, 20, 30];
const STEPS = 6; // welcome, how it works, goals, routine, first habit, done

let step = 0;
let state = freshState();

function freshState() {
  return {
    firstName: '', goalTracks: [],
    kind: null, routine: null, routineError: '', routineIds: [], routineTitle: '', routineDays: [], routineStart: '', routineEnd: '',
    habit: { idea: null, name: '', duration: 10, position: 'after', time: '20:00' }, habitError: '', habitSaved: null,
  };
}

export function renderOnboarding(onComplete) {
  step = 0;
  state = freshState();
  const app = document.getElementById('app');
  renderStep(app, onComplete);
}

function progressBar() {
  return `<div class="onboard-progress" role="progressbar" aria-valuemin="1" aria-valuemax="${STEPS}" aria-valuenow="${step + 1}" aria-label="${escapeAttr(t('obStepOf', { n: step + 1, total: STEPS }))}">${Array.from({ length: STEPS }, (_, i) => `<div class="ob-seg ${i <= step ? 'on' : ''}"></div>`).join('')}</div>`;
}

export function topControls() {
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

export function wireTopControls(container, rerender) {
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

function backBtn() {
  return `<button class="back-row" id="obBack">${icon.back} ${t('back')}</button>`;
}

function wireBack(app, rerender) {
  app.querySelector('#obBack')?.addEventListener('click', () => { step -= 1; rerender(); });
}

function focusHeading(app) {
  requestAnimationFrame(() => app.querySelector('h1, h2')?.focus({ preventScroll: true }));
}

function renderStep(app, onComplete) {
  const rerender = () => renderStep(app, onComplete);
  const go = (n) => { step = n; rerender(); window.scrollTo(0, 0); focusHeading(app); };

  if (step === 0) {
    app.innerHTML = `
      <div class="onboard-wrap">
        ${topControls()}
        ${progressBar()}
        <div style="flex:1"></div>
        <div class="center-text col" style="align-items:center;">
          <h1 class="screen-title font-head" style="font-size:26px;" tabindex="-1">${t('onboardWelcomeTitle')}</h1>
          <p class="screen-subtitle" style="max-width:340px;">${t('onboardWelcomeBody')}</p>
        </div>
        <div class="col" style="gap:8px;">
          <label class="label-sm" for="nameInput">${t('namePrompt')}</label>
          <input class="field" id="nameInput" placeholder="${t('namePlaceholder')}" value="${escapeAttr(state.firstName)}" maxlength="100" autocomplete="given-name" />
        </div>
        <div style="flex:1"></div>
        <button class="btn primary" id="nextBtn">${t('continueBtn')}</button>
      </div>
    `;
    wireTopControls(app, rerender);
    const input = app.querySelector('#nameInput');
    input.addEventListener('input', () => { state.firstName = input.value; });
    const next = () => {
      const val = input.value.trim();
      if (!val) { input.focus(); return; }
      state.firstName = val;
      go(1);
    };
    app.querySelector('#nextBtn').addEventListener('click', next);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') next(); });
    return;
  }

  if (step === 1) {
    app.innerHTML = `
      <div class="onboard-wrap">
        ${progressBar()}
        ${backBtn()}
        <div style="flex:1"></div>
        <div class="center-text col" style="align-items:center;">
          <div class="insight-icon-wrap">${icon.lock}</div>
          <h1 class="screen-title font-head" style="font-size:22px;" tabindex="-1">${t('onboardHowTitle')}</h1>
        </div>
        <div class="card" style="font-size:13px; line-height:1.6;">${t('onboardHowBody')}</div>
        <div style="flex:1"></div>
        <button class="btn primary" id="nextBtn">${t('continueBtn')}</button>
      </div>
    `;
    wireBack(app, rerender);
    app.querySelector('#nextBtn').addEventListener('click', () => go(2));
    return;
  }

  if (step === 2) {
    app.innerHTML = `
      <div class="onboard-wrap">
        ${progressBar()}
        ${backBtn()}
        <div>
          <h2 class="screen-title font-head" tabindex="-1">${t('onboardGoalTitle')}</h2>
          <p class="screen-subtitle">${t('onboardGoalBody')}</p>
        </div>
        <div class="goal-track-grid" id="goalGrid">
          ${GOAL_TRACKS.map((g) => `
            <button class="goal-track-card ${state.goalTracks.includes(g.id) ? 'selected' : ''}" data-id="${g.id}" aria-pressed="${state.goalTracks.includes(g.id)}">
              <div class="icon-circle">${icon[g.icon]}</div>
              <div class="name">${t(g.label)}</div>
            </button>
          `).join('')}
        </div>
        <div style="flex:1"></div>
        <button class="btn primary" id="nextBtn">${t('continueBtn')}</button>
      </div>
    `;
    wireBack(app, rerender);
    app.querySelectorAll('.goal-track-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        state.goalTracks = state.goalTracks.includes(id)
          ? state.goalTracks.filter((g) => g !== id)
          : [...state.goalTracks, id];
        rerender();
        app.querySelector(`.goal-track-card[data-id="${id}"]`)?.focus();
      });
    });
    app.querySelector('#nextBtn').addEventListener('click', () => go(3));
    return;
  }

  if (step === 3) { renderRoutineStep(app, rerender, go); return; }
  if (step === 4) { renderHabitStep(app, rerender, go); return; }

  // step 5 — done: show exactly what was set up
  const summary = [];
  if (state.routineIds.length) summary.push(`<li><span class="ob-sum-icon" aria-hidden="true">${icon.repeat}</span><span><strong>${escapeHtml(state.routineTitle)}</strong><br>${escapeHtml(daysText(state.routineDays))} · <span dir="ltr">${state.routineStart}–${state.routineEnd}</span></span></li>`);
  if (state.habitSaved) summary.push(`<li><span class="ob-sum-icon" aria-hidden="true">${icon.check}</span><span><strong>${escapeHtml(state.habitSaved.name)}</strong><br>${escapeHtml(state.habitSaved.when)}</span></li>`);
  app.innerHTML = `
    <div class="onboard-wrap">
      ${progressBar()}
      <div style="flex:1"></div>
      <div class="center-text col" style="align-items:center;">
        <div class="insight-icon-wrap">${icon.check}</div>
        <h1 class="screen-title font-head" style="font-size:24px;" tabindex="-1">${t('onboardDoneTitle')}</h1>
        <p class="screen-subtitle" style="max-width:340px;">${t(summary.length ? 'obDoneBodySetUp' : 'obDoneBodyEmpty')}</p>
      </div>
      ${summary.length ? `<ul class="card ob-summary">${summary.join('')}</ul>` : ''}
      <div style="flex:1"></div>
      <button class="btn primary" id="finishBtn">${t('obGoToToday')}</button>
    </div>
  `;
  app.querySelector('#finishBtn').addEventListener('click', () => {
    saveProfile({ firstName: state.firstName, goalTracks: state.goalTracks, onboarded: true });
    onComplete();
  });
}

// ---------- Step 4: the fixed schedule (recommended, optional) ----------

function weekPreset() {
  return getLang() === 'ar' ? [0, 1, 2, 3, 4] : [1, 2, 3, 4, 5];
}

function daysText(days) {
  if (days.length === 7) return t('everyDayLabel');
  return [...days].sort().map((d) => t(weekdayKey(d))).join(getLang() === 'ar' ? '، ' : ', ');
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function pickKind(id) {
  const k = ROUTINE_KINDS.find((x) => x.id === id);
  state.kind = id;
  state.routineError = '';
  state.routine = {
    title: k.title ? t(k.title) : '',
    days: id === 'other' ? [] : weekPreset(),
    start: k.start,
    end: k.end,
  };
}

function renderRoutineStep(app, rerender, go) {
  const existing = getEvents().filter((e) => e.type === 'weekly');
  const r = state.routine;
  const existingTitles = [...new Set(existing.map((e) => e.title))];
  const saved = state.routineIds.length > 0;
  app.innerHTML = `
    <div class="onboard-wrap">
      ${progressBar()}
      ${backBtn()}
      <div>
        <h2 class="screen-title font-head" tabindex="-1">${t('obRoutineTitle')}</h2>
        <p class="screen-subtitle">${t('obRoutineBody')}</p>
      </div>
      ${saved ? `
        <div class="card ob-saved" role="status">${icon.check} ${t('obRoutineSaved', { title: escapeHtml(state.routineTitle) })}</div>
      ` : existing.length ? `
        <div class="card ob-saved" role="status">${icon.check} ${t('obRoutineExisting', { list: escapeHtml(existingTitles.join(', ')) })}</div>
      ` : `
        <div class="ob-kinds" role="radiogroup" aria-label="${escapeAttr(t('obRoutineTitle'))}">
          ${ROUTINE_KINDS.map((k) => `
            <button class="ob-kind ${state.kind === k.id ? 'selected' : ''}" role="radio" aria-checked="${state.kind === k.id}" data-kind="${k.id}">
              <span class="ob-kind-icon" aria-hidden="true">${icon[k.icon]}</span>
              <span class="ob-kind-name">${t(k.label)}</span>
            </button>
          `).join('')}
        </div>
        ${r ? routineFormHtml(r) : ''}
      `}
      <div style="flex:1"></div>
      ${saved || existing.length
        ? `<button class="btn primary" id="nextBtn">${t('continueBtn')}</button>`
        : r ? `<button class="btn primary" id="saveRoutineBtn">${t('obSaveRoutine')}</button>` : ''}
      ${saved || existing.length ? '' : `<button class="btn ghost" id="skipBtn">${t('obNoFixedSchedule')}</button>`}
    </div>
  `;
  wireBack(app, rerender);
  app.querySelector('#nextBtn')?.addEventListener('click', () => go(4));
  app.querySelector('#skipBtn')?.addEventListener('click', () => go(4));
  app.querySelectorAll('.ob-kind').forEach((btn) => {
    btn.addEventListener('click', () => {
      pickKind(btn.dataset.kind);
      rerender();
      requestAnimationFrame(() => {
        const title = app.querySelector('#obRoutineName');
        title?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (!title?.value) title?.focus({ preventScroll: true });
      });
    });
  });
  if (!r || saved || existing.length) return;

  const capture = () => {
    r.title = app.querySelector('#obRoutineName').value;
    r.start = app.querySelector('#obStart').value;
    r.end = app.querySelector('#obEnd').value;
  };
  app.querySelectorAll('.ob-day').forEach((chip) => {
    chip.addEventListener('click', () => {
      capture();
      const d = Number(chip.dataset.day);
      r.days = r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d].sort();
      rerender();
      app.querySelector(`.ob-day[data-day="${d}"]`)?.focus();
    });
  });
  const durNote = () => {
    const s = app.querySelector('#obStart').value;
    const e = app.querySelector('#obEnd').value;
    app.querySelector('.dur-note').textContent = s && e && toMinutes(e) > toMinutes(s) ? t('durationIs', { dur: durText(toMinutes(e) - toMinutes(s)) }) : '';
  };
  app.querySelector('#obStart').addEventListener('input', durNote);
  app.querySelector('#obEnd').addEventListener('input', durNote);

  app.querySelector('#saveRoutineBtn').addEventListener('click', () => {
    capture();
    const title = r.title.trim();
    state.routineError = !title ? t('nlMissingTitle')
      : !r.days.length ? t('nlMissingDays')
      : !r.start ? t('nlMissingStart')
      : !r.end ? t('nlMissingEnd')
      : toMinutes(r.end) <= toMinutes(r.start) ? t('evErrOrder') : '';
    if (state.routineError) { rerender(); app.querySelector('.form-error')?.scrollIntoView({ block: 'center' }); return; }
    const seriesId = uid();
    addEvents(r.days.map((d) => ({ title, type: 'weekly', dayOfWeek: d, startDate: todayStr(), start: r.start, end: r.end, source: 'manual', seriesId })));
    state.routineIds = getEvents().filter((e) => e.seriesId === seriesId).map((e) => e.id);
    state.routineTitle = title;
    state.routineDays = [...r.days];
    state.routineStart = r.start;
    state.routineEnd = r.end;
    go(4);
  });
}

function durText(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h && m ? t('durHM', { h, m }) : h ? t('durH', { h }) : t('durM', { m });
}

function routineFormHtml(r) {
  const dur = r.start && r.end && toMinutes(r.end) > toMinutes(r.start) ? t('durationIs', { dur: durText(toMinutes(r.end) - toMinutes(r.start)) }) : '';
  return `
    <div class="card col ob-routine-form">
      <div class="col">
        <label class="label-sm" for="obRoutineName">${t('eventNameLabel')}</label>
        <input class="field" id="obRoutineName" value="${escapeAttr(r.title)}" placeholder="${escapeAttr(t('routineTitlePlaceholder'))}" maxlength="80" />
      </div>
      <div>
        <div class="label-sm" style="margin-bottom:6px;">${t('repeatsOnLabel')}</div>
        <div class="wrap-gap" role="group" aria-label="${escapeAttr(t('repeatsOnLabel'))}">
          ${[0, 1, 2, 3, 4, 5, 6].map((d) => `<button type="button" class="chip clickable weekday-chip ob-day ${r.days.includes(d) ? 'solid' : ''}" data-day="${d}" aria-pressed="${r.days.includes(d)}">${t(weekdayKey(d))}</button>`).join('')}
        </div>
      </div>
      <div class="row" style="gap:8px;">
        <div class="col grow"><label class="label-sm" for="obStart">${t('eventStart')}</label><input class="field" type="time" id="obStart" value="${escapeAttr(r.start)}" /></div>
        <div class="col grow"><label class="label-sm" for="obEnd">${t('eventEnd')}</label><input class="field" type="time" id="obEnd" value="${escapeAttr(r.end)}" /></div>
      </div>
      <div class="form-note dur-note" aria-live="polite">${dur}</div>
      <p class="form-note">${t('obRoutineEditLater')}</p>
      ${state.routineError ? `<div class="form-error" role="alert">${state.routineError}</div>` : ''}
    </div>
  `;
}

// ---------- Step 5: one small first habit, placed around the routine ----------

function ideas() {
  const keys = [];
  const add = (list) => (list || []).forEach((i) => { if (!keys.some((k) => k[0] === i[0])) keys.push(i); });
  if (state.routineIds.length) add(HABIT_IDEAS[state.kind || 'other']);
  state.goalTracks.forEach((g) => add(HABIT_IDEAS[g]));
  add(HABIT_IDEAS.none);
  return keys.slice(0, 4);
}

function habitPreview() {
  const h = state.habit;
  if (!state.routineIds.length) {
    return h.time ? t('obHabitDailyAt', { time: `<span dir="ltr">${h.time}–${addMinutes(h.time, h.duration)}</span>` }) : '';
  }
  const now = new Date();
  const nowHM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const next = previewStackedOccurrences(state.routineIds, 0, h.duration, 2, todayStr(), h.position)
    .find((o) => o.date > todayStr() || o.start > nowHM); // today's slot only if it's still ahead
  if (!next) return '';
  const day = dateForDisplay(next.date).toLocaleDateString(getLang() === 'ar' ? 'ar' : 'en-US', { weekday: 'long' });
  return t('obHabitFirstOn', { day: escapeHtml(day), time: `<span dir="ltr">${next.start}–${next.end}</span>` });
}

function addMinutes(hhmm, mins) {
  const v = (toMinutes(hhmm) + mins + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

function renderHabitStep(app, rerender, go) {
  const h = state.habit;
  const list = ideas();
  const stacked = state.routineIds.length > 0;
  const routineName = escapeHtml(state.routineTitle);
  if (state.habitSaved) {
    // Already added (the user came back with "Back"): don't offer to add it twice.
    app.innerHTML = `
      <div class="onboard-wrap">
        ${progressBar()}
        ${backBtn()}
        <h2 class="screen-title font-head" tabindex="-1">${stacked ? t('obHabitTitleStacked', { title: routineName }) : t('obHabitTitle')}</h2>
        <div class="card ob-saved" role="status">${icon.check} ${t('obHabitSaved', { name: escapeHtml(state.habitSaved.name) })}</div>
        <div style="flex:1"></div>
        <button class="btn primary" id="nextBtn">${t('continueBtn')}</button>
      </div>
    `;
    wireBack(app, rerender);
    app.querySelector('#nextBtn').addEventListener('click', () => go(5));
    return;
  }
  app.innerHTML = `
    <div class="onboard-wrap">
      ${progressBar()}
      ${backBtn()}
      <div>
        <h2 class="screen-title font-head" tabindex="-1">${stacked ? t('obHabitTitleStacked', { title: routineName }) : t('obHabitTitle')}</h2>
        <p class="screen-subtitle">${t(stacked ? 'obHabitBodyStacked' : 'obHabitBody', { title: routineName })}</p>
      </div>
      <div class="ob-ideas" role="radiogroup" aria-label="${escapeAttr(t('obHabitIdeasLabel'))}">
        ${list.map(([key, dur, pos]) => `
          <button class="ob-idea ${h.idea === key ? 'selected' : ''}" role="radio" aria-checked="${h.idea === key}" data-idea="${key}" data-duration="${dur}" data-position="${pos}">${t(key)}</button>
        `).join('')}
        <button class="ob-idea ${h.idea === 'own' ? 'selected' : ''}" role="radio" aria-checked="${h.idea === 'own'}" data-idea="own">${t('obIdeaOwn')}</button>
      </div>
      ${h.idea ? `
        <div class="card col ob-habit-form">
          <div class="col">
            <label class="label-sm" for="obHabitName">${t('habitQWhat')}</label>
            <input class="field" id="obHabitName" value="${escapeAttr(h.name)}" maxlength="200" />
          </div>
          <div>
            <div class="label-sm" style="margin-bottom:6px;" id="obDurLabel">${t('habitQHowLong')}</div>
            <div class="choice-row" role="radiogroup" aria-labelledby="obDurLabel">
              ${DURATIONS.map((d) => `<button type="button" class="choice ${h.duration === d ? 'on' : ''}" role="radio" aria-checked="${h.duration === d}" data-dur="${d}">${t('minutesShort', { n: d })}</button>`).join('')}
            </div>
          </div>
          ${stacked ? `
            <div class="seg" role="radiogroup" aria-label="${escapeAttr(t('obWhenLabel'))}">
              <button type="button" role="radio" class="seg-btn ${h.position === 'before' ? 'on' : ''}" data-pos="before" aria-checked="${h.position === 'before'}">${t('obBeforeRoutine', { title: routineName })}</button>
              <button type="button" role="radio" class="seg-btn ${h.position === 'after' ? 'on' : ''}" data-pos="after" aria-checked="${h.position === 'after'}">${t('obAfterRoutine', { title: routineName })}</button>
            </div>
          ` : `
            <div class="col"><label class="label-sm" for="obHabitTime">${t('obHabitTimeLabel')}</label><input class="field" type="time" id="obHabitTime" value="${escapeAttr(h.time)}" /></div>
          `}
          <div class="form-note ob-preview" aria-live="polite">${habitPreview()}</div>
          ${state.habitError ? `<div class="form-error" role="alert">${state.habitError}</div>` : ''}
        </div>
      ` : ''}
      <div style="flex:1"></div>
      ${h.idea ? `<button class="btn primary" id="saveHabitBtn">${t('obSaveHabit')}</button>` : ''}
      <button class="btn ghost" id="skipBtn">${t('obSkipHabit')}</button>
    </div>
  `;
  wireBack(app, rerender);
  app.querySelector('#skipBtn').addEventListener('click', () => go(5));
  const capture = () => {
    const n = app.querySelector('#obHabitName');
    if (n) h.name = n.value;
    const tm = app.querySelector('#obHabitTime');
    if (tm) h.time = tm.value;
  };
  app.querySelectorAll('.ob-idea').forEach((btn) => {
    btn.addEventListener('click', () => {
      capture();
      h.idea = btn.dataset.idea;
      state.habitError = '';
      if (h.idea === 'own') {
        h.name = '';
      } else {
        h.name = t(h.idea);
        h.duration = Number(btn.dataset.duration);
        h.position = btn.dataset.position;
      }
      rerender();
      requestAnimationFrame(() => {
        const name = app.querySelector('#obHabitName');
        name?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (h.idea === 'own') name?.focus({ preventScroll: true });
      });
    });
  });
  app.querySelectorAll('[data-dur]').forEach((b) => b.addEventListener('click', () => { capture(); h.duration = Number(b.dataset.dur); rerender(); }));
  app.querySelectorAll('[data-pos]').forEach((b) => b.addEventListener('click', () => { capture(); h.position = b.dataset.pos; rerender(); }));
  app.querySelector('#obHabitTime')?.addEventListener('input', () => {
    capture();
    app.querySelector('.ob-preview').innerHTML = habitPreview();
  });

  app.querySelector('#saveHabitBtn')?.addEventListener('click', () => {
    capture();
    const name = h.name.trim();
    state.habitError = !name ? t('habitErrName') : (!stacked && !h.time ? t('nlMissingStart') : '');
    if (state.habitError) { rerender(); return; }
    if (stacked) {
      addHabit({ name, scheduleType: 'stacked', stackEventIds: state.routineIds, offsetMinutes: 0, stackPosition: h.position, duration: h.duration });
    } else {
      addHabit({ name, scheduleType: 'independent', time: h.time, duration: h.duration });
    }
    const when = stacked
      ? `${t(h.position === 'before' ? 'obBeforeRoutine' : 'obAfterRoutine', { title: state.routineTitle })} · ${t('minutesShort', { n: h.duration })}`
      : `${t('everyDayLabel')} · ${h.time}–${addMinutes(h.time, h.duration)}`;
    state.habitSaved = { name, when };
    go(5);
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
