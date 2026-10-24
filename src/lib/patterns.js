import { getAllMorningEntries, getAllEveningEntries, dayOfWeek } from '../db.js';
import { t, getLang } from '../i18n.js';

const WEEKDAY_KEYS = ['weekdaySun', 'weekdayMon', 'weekdayTue', 'weekdayWed', 'weekdayThu', 'weekdayFri', 'weekdaySat'];

export function weekdayKey(dow) {
  return WEEKDAY_KEYS[dow];
}

// Looks for a priority that keeps getting marked "missed" on the same weekday.
export function detectPattern() {
  const morningAll = getAllMorningEntries();
  const eveningAll = getAllEveningEntries();
  const misses = [];

  Object.keys(eveningAll).forEach((date) => {
    const evening = eveningAll[date];
    const morning = morningAll[date];
    if (!morning || !evening.completion) return;
    evening.completion.forEach((done, i) => {
      const priority = morning.priorities[i];
      if (!done && priority && priority.text.trim()) {
        misses.push({ date, weekday: dayOfWeek(date), text: priority.text.trim().toLowerCase() });
      }
    });
  });

  const groups = {};
  misses.forEach((m) => {
    const key = `${m.weekday}::${m.text}`;
    groups[key] = groups[key] || [];
    groups[key].push(m);
  });

  const patterns = Object.values(groups)
    .filter((g) => g.length >= 2)
    .sort((a, b) => b.length - a.length);

  if (!patterns.length) return null;
  const top = patterns[0];
  return {
    weekday: top[0].weekday,
    text: top[0].text,
    count: top.length,
  };
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

export function patternSentence(pattern) {
  const day = t(weekdayKey(pattern.weekday));
  if (getLang() === 'ar') {
    return `فوّتّ "${escapeHtml(pattern.text)}" في يوم ${day} لـ ${pattern.count} مرات متتالية.`;
  }
  return `You've missed "${escapeHtml(pattern.text)}" on ${day}s ${pattern.count} times.`;
}
