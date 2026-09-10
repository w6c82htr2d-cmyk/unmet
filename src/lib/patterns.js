import { getAllMorningEntries, getAllEveningEntries, dayOfWeek } from '../db.js';

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

export function daysLoggedThisWeek() {
  const eveningAll = getAllEveningEntries();
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    if (eveningAll[key]) count += 1;
  }
  return count;
}
