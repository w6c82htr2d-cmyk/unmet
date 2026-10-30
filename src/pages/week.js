// "Your Week, Unmet": six short slides about one finished week — the overview, wins, patterns,
// comeback moments, one thing to try next, and a shareable finale. Built only from this device's
// check-ins; weeks without enough history say so instead of showing thin or invented numbers.
import { t, getLang } from '../i18n.js';
import { icon } from '../icons.js';
import { getHabits, addDays, updateHabit } from '../db.js';
import { navigate, currentPath } from '../router.js';
import { computeRecap, lastCompleteWeek, weekStartOf, markRecapSeen } from '../lib/weeklyRecap.js';
import { patternText, weekdayLong } from '../lib/homeInsight.js';
import { dismissInsight } from '../lib/habitPatterns.js';
import { requestHabitEdit } from '../lib/pendingEdit.js';
import { showUndoToast } from '../lib/undoToast.js';
import { drawRecapImage, shareRecapImage } from '../lib/recapImage.js';
import { weekRangeText } from '../lib/weeklyRecapCard.js';

const SLIDES = 6;
let slide = 0;
let shownWeek = null;
let includeNames = false;
let improvementDone = false;
let improveConfirm = false;
let shareStatus = '';
let keyGo = null;
let keysBound = false;

function requestedWeek() {
  const q = new URLSearchParams(currentPath().split('?')[1] || '');
  const w = q.get('w');
  const latest = lastCompleteWeek();
  if (w && /^\d{4}-\d{2}-\d{2}$/.test(w)) {
    const start = weekStartOf(w);
    return start <= latest ? start : latest;
  }
  return latest;
}


function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderWeek(root) {
  const week = requestedWeek();
  if (week !== shownWeek) { shownWeek = week; slide = 0; improvementDone = false; improveConfirm = false; shareStatus = ''; }
  const recap = computeRecap(getHabits(), week);
  const range = weekRangeText(week);
  const latest = lastCompleteWeek();
  if (recap.enough && week === latest) markRecapSeen(week);
  const rerender = () => renderWeek(root);

  root.innerHTML = `
    <div class="page recap-page">
      <div class="recap-top">
        <button class="back-row" id="recapClose">${icon.back} ${t('back')}</button>
        <div class="recap-weeknav">
          <button class="icon-btn" id="prevWeek" aria-label="${escapeHtml(t('recapPrevWeek'))}">${icon.back}</button>
          <span class="recap-range" dir="auto">${escapeHtml(range)}</span>
          <button class="icon-btn flip-x" id="nextWeek" aria-label="${escapeHtml(t('recapNextWeek'))}" ${week >= latest ? 'disabled' : ''}>${icon.back}</button>
        </div>
      </div>
      ${recap.enough ? slidesHtml(recap, range) : notEnoughHtml(recap, range)}
    </div>
  `;

  root.querySelector('#recapClose').addEventListener('click', () => navigate('/'));
  root.querySelector('#prevWeek').addEventListener('click', () => navigate(`/week?w=${addDays(week, -7)}`));
  root.querySelector('#nextWeek').addEventListener('click', () => { if (week < latest) navigate(`/week?w=${addDays(week, 7)}`); });
  if (!recap.enough) return;
  wireSlides(root, recap, range, rerender);
}

function notEnoughHtml(recap, range) {
  return `
    <section class="recap-slide s-plain" aria-labelledby="recapNoneTitle">
      <div class="recap-kicker">${t('recapTitle')}</div>
      <h1 class="recap-big-title" id="recapNoneTitle">${t('recapNotEnoughTitle')}</h1>
      <p class="recap-line">${t('recapNotEnoughBody', { range: escapeHtml(range), min: 5, days: 3, have: recap.scheduled })}</p>
      <button class="btn primary" id="recapHome">${t('recapBackHome')}</button>
    </section>
  `;
}

function dotsHtml() {
  return `
    <div class="recap-dots" role="tablist" aria-label="${escapeHtml(t('recapSlidesLabel'))}">
      ${Array.from({ length: SLIDES }, (_, i) => `<button class="recap-dot ${i === slide ? 'on' : ''}" role="tab" aria-selected="${i === slide}" aria-label="${escapeHtml(t('recapSlideN', { n: i + 1, total: SLIDES }))}" data-slide="${i}"></button>`).join('')}
    </div>
  `;
}

function slidesHtml(recap, range) {
  const body = [slideOverview, slideWins, slidePatterns, slideComebacks, slideImprove, slideFinale][slide](recap, range);
  return `
    ${dotsHtml()}
    <div class="recap-stage" id="recapStage" aria-live="polite">${body}</div>
    <div class="recap-nav">
      <button class="btn secondary grow" id="recapPrev" ${slide === 0 ? 'disabled' : ''}>${t('recapPrev')}</button>
      ${slide < SLIDES - 1
        ? `<button class="btn primary grow" id="recapNext">${t('recapNext')}</button>`
        : `<button class="btn primary grow" id="recapDone">${t('recapDone')}</button>`}
    </div>
  `;
}

// 1 — the week at a glance
function slideOverview(r, range) {
  const diff = r.prevPct === null ? '' : r.pct > r.prevPct ? t('recapUpFrom', { pct: r.prevPct }) : r.pct < r.prevPct ? t('recapDownFrom', { pct: r.prevPct }) : t('recapSameAs', { pct: r.prevPct });
  return `
    <section class="recap-slide s-accent" aria-labelledby="rs1">
      <div class="recap-kicker">${t('recapTitle')} · <span dir="auto">${escapeHtml(range)}</span></div>
      <h1 class="recap-big-title" id="rs1">${t('recapOverviewTitle')}</h1>
      <div class="recap-number" dir="ltr">${r.pct}<span>%</span></div>
      <p class="recap-line strong">${t('recapCheckins', { done: r.done, total: r.scheduled })}</p>
      <p class="recap-line">${t('recapActiveDays', { n: r.activeDays })}</p>
      ${diff ? `<p class="recap-line">${diff}</p>` : ''}
    </section>
  `;
}

// 2 — wins
function slideWins(r) {
  const best = r.bestDay ? t('recapBestDay', { day: weekdayLong(new Date(`${r.bestDay.date}T12:00:00`).getDay()), n: r.bestDay.done }) : '';
  return `
    <section class="recap-slide s-plain" aria-labelledby="rs2">
      <div class="recap-kicker">${t('recapWinsKicker')}</div>
      <h2 class="recap-big-title" id="rs2">${t(r.top.length ? 'recapWinsTitle' : 'recapWinsNoneTitle')}</h2>
      ${r.top.length ? `
        <ol class="recap-list">
          ${r.top.map((h) => `<li><span class="rl-name">${escapeHtml(h.name)}</span><span class="rl-val" dir="ltr">${h.done}/${h.total}</span></li>`).join('')}
        </ol>
      ` : `<p class="recap-line">${t('recapWinsNoneBody')}</p>`}
      ${r.perfect.length ? `<p class="recap-line">${t('recapPerfect', { names: r.perfect.map(escapeHtml).join(getLang() === 'ar' ? '، ' : ', ') })}</p>` : ''}
      ${best ? `<p class="recap-line">${best}</p>` : ''}
    </section>
  `;
}

// 3 — patterns: the streak, the shape of the week, and one pattern from history if there is one
function slidePatterns(r) {
  const max = Math.max(1, ...r.perDay.map((d) => d.scheduled));
  const letters = getLang() === 'ar' ? ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const pat = r.pattern ? patternText(r.pattern) : null;
  return `
    <section class="recap-slide s-deep" aria-labelledby="rs3">
      <div class="recap-kicker">${t('recapPatternsKicker')}</div>
      <h2 class="recap-big-title" id="rs3">${r.streak ? t('recapStreakTitle', { n: r.streak.days }) : t('recapShapeTitle')}</h2>
      ${r.streak ? `<p class="recap-line strong">${escapeHtml(r.streak.name)}</p>` : ''}
      <div class="recap-bars" role="img" aria-label="${escapeHtml(r.perDay.map((d, i) => `${weekdayLong(i)}: ${d.done}/${d.scheduled}`).join(', '))}">
        ${r.perDay.map((d, i) => `
          <div class="rb">
            <div class="rb-track" style="height:${Math.round((d.scheduled / max) * 100)}%"><div class="rb-fill" style="height:${d.scheduled ? Math.round((d.done / d.scheduled) * 100) : 0}%"></div></div>
            <div class="rb-l" aria-hidden="true">${letters[i]}</div>
          </div>
        `).join('')}
      </div>
      <p class="recap-note">${t('recapBarsNote')}</p>
      ${pat ? `<div class="recap-pattern"><div class="rp-title">${pat.title}</div><p>${pat.body}</p></div>` : ''}
    </section>
  `;
}

// 4 — comeback moments
function slideComebacks(r) {
  return `
    <section class="recap-slide s-accent" aria-labelledby="rs4">
      <div class="recap-kicker">${t('recapComebackKicker')}</div>
      <h2 class="recap-big-title" id="rs4">${r.comebacks.length ? t(r.comebacks.length === 1 ? 'recapComebackTitleOne' : 'recapComebackTitle', { n: r.comebacks.length }) : t('recapComebackNoneTitle')}</h2>
      ${r.comebacks.length ? `
        <ul class="recap-list">
          ${r.comebacks.slice(0, 4).map((c) => `<li><span class="rl-name">${escapeHtml(c.habitName)}</span><span class="rl-val">${t('recapComebackItem', { day: weekdayLong(new Date(`${c.date}T12:00:00`).getDay()), n: c.missedBefore })}</span></li>`).join('')}
        </ul>
      ` : `<p class="recap-line">${t('recapComebackNoneBody')}</p>`}
    </section>
  `;
}

// 5 — one actionable improvement
function slideImprove(r) {
  const imp = r.improvement;
  let title = t('recapKeepTitle');
  let bodyText = t('recapKeepBody');
  let action = '';
  if (imp.kind === 'pattern') {
    const p = imp.pattern;
    const txt = patternText(p);
    title = p.action.kind === 'skipDay' ? t('recapImproveSkip', { name: escapeHtml(p.habitName), day: weekdayLong(p.action.dow) }) : t('recapImproveShorten', { name: escapeHtml(p.habitName), minutes: p.action.minutes });
    bodyText = txt.body;
    const label = p.action.kind === 'skipDay' ? t('patActionSkip', { day: weekdayLong(p.action.dow) }) : t('patActionShorten', { minutes: p.action.minutes });
    const confirmMsg = p.action.kind === 'skipDay'
      ? t('patConfirmSkip', { name: escapeHtml(p.habitName), day: weekdayLong(p.action.dow) })
      : t('patConfirmShorten', { name: escapeHtml(p.habitName), minutes: p.action.minutes, old: getHabits().find((h) => h.id === p.habitId)?.duration || '' });
    action = improvementDone
      ? `<p class="recap-line strong">${t('recapImproveApplied')}</p>`
      : improveConfirm
        ? `<div class="recap-confirm"><p class="recap-line">${confirmMsg}</p><div class="row" style="gap:8px;"><button class="btn primary grow" id="recapConfirm">${t('patConfirmBtn')}</button><button class="btn secondary grow" id="recapCancel">${t('cancel')}</button></div></div>`
        : `<button class="btn primary" id="recapApply">${label}</button><p class="recap-note">${t('recapApplyNote')}</p>`;
  } else if (imp.kind === 'smaller') {
    title = t('recapImproveSmaller', { name: escapeHtml(imp.habitName) });
    bodyText = t('recapImproveSmallerBody', { done: imp.done, total: imp.total });
    action = `<button class="btn primary" id="recapEditHabit">${t('patActionEdit')}</button>`;
  }
  return `
    <section class="recap-slide s-plain" aria-labelledby="rs5">
      <div class="recap-kicker">${t('recapImproveKicker')}</div>
      <h2 class="recap-big-title" id="rs5">${title}</h2>
      <p class="recap-line">${bodyText}</p>
      ${action}
    </section>
  `;
}

// 6 — shareable finale
function slideFinale(r, range) {
  return `
    <section class="recap-slide s-deep" aria-labelledby="rs6">
      <div class="recap-kicker">${t('recapFinaleKicker')}</div>
      <h2 class="recap-big-title" id="rs6">${t('recapFinaleTitle')}</h2>
      <div class="recap-share-card" aria-hidden="true">
        <div class="rsc-brand">UNMET</div>
        <div class="rsc-title">${t('recapTitle')}</div>
        <div class="rsc-range" dir="auto">${escapeHtml(range)}</div>
        <div class="rsc-num" dir="ltr">${r.pct}%</div>
        <div class="rsc-line">${t('recapCheckins', { done: r.done, total: r.scheduled })}</div>
        <div class="rsc-line">${t('recapActiveDays', { n: r.activeDays })}</div>
        ${r.streak ? `<div class="rsc-line">${includeNames ? t('recapStreakNamed', { n: r.streak.days, name: escapeHtml(r.streak.name) }) : t('recapStreak', { n: r.streak.days })}</div>` : ''}
      </div>
      <label class="recap-toggle"><input type="checkbox" id="includeNames" ${includeNames ? 'checked' : ''}/> ${t('recapIncludeNames')}</label>
      <button class="btn primary" id="recapShare">${icon.share} ${t('recapShareBtn')}</button>
      <p class="recap-note" role="status">${shareStatus || t('recapShareNote')}</p>
    </section>
  `;
}

function wireSlides(root, recap, range, rerender) {
  const go = (n) => {
    slide = Math.max(0, Math.min(SLIDES - 1, n));
    rerender();
    root.querySelector('.recap-slide h1, .recap-slide h2')?.setAttribute('tabindex', '-1');
    root.querySelector('.recap-slide h1, .recap-slide h2')?.focus({ preventScroll: true });
  };
  root.querySelector('#recapPrev').addEventListener('click', () => go(slide - 1));
  root.querySelector('#recapNext')?.addEventListener('click', () => go(slide + 1));
  root.querySelector('#recapDone')?.addEventListener('click', () => navigate('/'));
  root.querySelectorAll('.recap-dot').forEach((d) => d.addEventListener('click', () => go(Number(d.dataset.slide))));

  // Arrow keys and swipes follow reading direction.
  const rtl = getLang() === 'ar';
  const stage = root.querySelector('#recapStage');
  stage.tabIndex = -1;
  keyGo = (e) => {
    if (e.target.matches?.('input:not([type=checkbox]), textarea, select')) return;
    if (e.key === 'ArrowRight') go(slide + (rtl ? -1 : 1));
    if (e.key === 'ArrowLeft') go(slide + (rtl ? 1 : -1));
  };
  if (!keysBound) {
    keysBound = true;
    // One listener for the app's lifetime; it only acts while a recap is on screen.
    document.addEventListener('keydown', (e) => {
      if (keyGo && currentPath().startsWith('/week') && document.querySelector('#recapStage')) keyGo(e);
    });
  }
  let sx = null;
  let sy = null;
  stage.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
  stage.addEventListener('pointerup', (e) => {
    if (sx === null) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(slide + ((dx < 0) !== rtl ? 1 : -1));
  });

  root.querySelector('#recapApply')?.addEventListener('click', () => {
    improveConfirm = true;
    rerender();
    root.querySelector('#recapConfirm')?.focus();
  });
  root.querySelector('#recapCancel')?.addEventListener('click', () => { improveConfirm = false; rerender(); });
  root.querySelector('#recapConfirm')?.addEventListener('click', () => {
    improveConfirm = false;
    const p = recap.improvement.pattern;
    const habit = getHabits().find((h) => h.id === p.habitId);
    if (!habit) return;
    const before = { days: habit.days, duration: habit.duration };
    if (p.action.kind === 'skipDay') {
      const base = habit.days && habit.days.length ? habit.days : [0, 1, 2, 3, 4, 5, 6];
      updateHabit(habit.id, { days: base.filter((d) => d !== p.action.dow) });
    } else {
      updateHabit(habit.id, { duration: p.action.minutes });
    }
    dismissInsight(p.id);
    improvementDone = true;
    rerender();
    showUndoToast(t('patAppliedToast', { name: habit.name }), t('undoBtn'), () => {
      updateHabit(habit.id, before);
      improvementDone = false;
      rerender();
    });
  });
  root.querySelector('#recapEditHabit')?.addEventListener('click', () => {
    requestHabitEdit(recap.improvement.habitId);
    navigate('/');
  });
  root.querySelector('#includeNames')?.addEventListener('change', (e) => { includeNames = e.target.checked; rerender(); });
  root.querySelector('#recapShare')?.addEventListener('click', async () => {
    try {
      const canvas = drawRecapImage(recap, { includeNames, range });
      const result = await shareRecapImage(canvas, `unmet-week-${recap.weekStart}.png`);
      shareStatus = result === 'downloaded' ? t('recapSavedImage') : result === 'shared' ? t('recapShared') : '';
    } catch {
      shareStatus = t('recapShareFailed');
    }
    if (currentPath().startsWith('/week')) rerender();
  });
}

