import { t, getLang } from '../i18n.js';
import { icon } from '../icons.js';
import { getProfile, getHabits, getAllMorningEntries, getAllEveningEntries, habitStreak, todayStr } from '../db.js';
import { detectPattern, daysLoggedThisWeek, weekdayKey } from '../lib/patterns.js';
import { navigate } from '../router.js';

const STUDY_WORDS = ['study', 'exam', 'class', 'homework', 'assignment', 'lecture', 'thesis', 'read'];
const FITNESS_WORDS = ['gym', 'workout', 'run', 'exercise', 'fitness'];
const LANGUAGE_WORDS = ['spanish', 'language', 'duolingo', 'vocab', 'learn'];

function lastNDays(n) {
  const days = [];
  for (let i = 0; i < n; i++) days.push(todayStr(-i));
  return days;
}

function computeStats(profile) {
  const days = lastNDays(7);
  const morningAll = getAllMorningEntries();
  const eveningAll = getAllEveningEntries();
  const habits = getHabits();

  let studyMinutes = 0;
  let moodSum = 0;
  let moodCount = 0;

  days.forEach((date) => {
    const morning = morningAll[date];
    const evening = eveningAll[date];
    if (evening) {
      moodSum += evening.mood || 0;
      moodCount += 1;
    }
    if (morning && evening) {
      morning.priorities.forEach((p, i) => {
        if (evening.completion[i] && p.text && STUDY_WORDS.some((w) => p.text.toLowerCase().includes(w))) {
          studyMinutes += Number(p.minutes) || 0;
        }
      });
    }
  });

  const gymSessions = habits
    .filter((h) => FITNESS_WORDS.some((w) => h.name.toLowerCase().includes(w)))
    .reduce((sum, h) => sum + days.filter((d) => h.history[d]).length, 0);

  const languageHabits = habits.filter((h) => LANGUAGE_WORDS.some((w) => h.name.toLowerCase().includes(w)));
  const languageStreak = languageHabits.length ? Math.max(...languageHabits.map(habitStreak)) : 0;

  const avgMood = moodCount ? (moodSum / moodCount) : null;
  const longestStreak = habits.length ? Math.max(0, ...habits.map(habitStreak)) : 0;

  const stats = [];
  const tracks = profile?.goalTracks || [];

  if (tracks.includes('gpa')) stats.push({ label: t('statStudy'), value: (studyMinutes / 60).toFixed(1), suffix: 'h' });
  if (tracks.includes('fitness')) stats.push({ label: t('statGym'), value: gymSessions, suffix: '' });
  if (tracks.includes('language')) stats.push({ label: t('statLang'), value: languageStreak, suffix: getLang() === 'ar' ? 'ي' : 'd' });
  if (avgMood !== null) stats.push({ label: t('statMood'), value: avgMood.toFixed(1), suffix: '/5' });
  if (!stats.length) stats.push({ label: t('statMood'), value: '—', suffix: '' });
  if (tracks.length && !avgMood && stats.length < 2) stats.push({ label: t('navCheckin'), value: longestStreak, suffix: '🔥' });

  return stats;
}

export function renderCheckin(root) {
  const profile = getProfile();
  const loggedDays = daysLoggedThisWeek();
  const pattern = detectPattern();
  const stats = computeStats(profile);

  root.innerHTML = `
    <div class="page">
      <div>
        <h2 class="screen-title">${t('checkinTitle')}</h2>
        <div class="screen-subtitle">${t('daysLogged', { n: loggedDays })}</div>
      </div>

      ${loggedDays < 2 ? `
        <div class="empty-state card">
          <div class="icon-circle">${icon.checkin}</div>
          <div class="title">${t('noDataYetTitle')}</div>
          <div class="body">${t('noDataYetBody')}</div>
          <button class="btn primary" id="logTodayBtn" style="margin-top:12px;">${t('logFirstWeek')}</button>
        </div>
      ` : `
        <div class="stat-grid">
          ${stats.map((s) => `
            <div class="stat-card">
              <div class="label-sm">${s.label}</div>
              <div class="value-lg">${s.value}<span style="font-size:11px; color:var(--text-muted); font-weight:600;">${s.suffix}</span></div>
            </div>
          `).join('')}
        </div>

        ${pattern ? `
          <div class="card on-accent">
            <div class="row" style="gap:7px; margin-bottom:6px;">
              ${icon.alert}
              <span style="font-size:11.5px; font-weight:700;">${t('insightTitle')}</span>
            </div>
            <div style="font-size:12px; line-height:1.5; margin-bottom:10px;">${insightSentence(pattern)}</div>
            <button class="chip clickable" id="insightCta" style="background:rgba(255,255,255,0.9); color:var(--accent); justify-content:center; width:100%; padding:7px 0; border:none;">${t('insightCta')}</button>
          </div>
        ` : ''}
      `}
    </div>
  `;

  const logBtn = root.querySelector('#logTodayBtn');
  if (logBtn) logBtn.addEventListener('click', () => navigate('/journal/morning'));
  const insightBtn = root.querySelector('#insightCta');
  if (insightBtn) insightBtn.addEventListener('click', () => navigate('/insight'));
}

function insightSentence(pattern) {
  const day = t(weekdayKey(pattern.weekday));
  if (getLang() === 'ar') {
    return `فوّتّ "${escapeHtml(pattern.text)}" في يوم ${day} لـ ${pattern.count} مرات متتالية.`;
  }
  return `You've missed "${escapeHtml(pattern.text)}" on ${day}s ${pattern.count} times.`;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
