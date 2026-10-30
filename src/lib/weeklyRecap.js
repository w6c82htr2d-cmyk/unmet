// "Your Week, Unmet": a recap of one Sunday–Saturday week, computed on this device from the user's
// own check-ins. Every number is a count from that history; nothing is estimated or invented. When
// there isn't enough to say something honestly, `enough` is false and the recap says so.
import { todayStr, addDays, dayOfWeek } from '../db.js';
import { scheduledDays, comebacks, findHabitPatterns } from './habitPatterns.js';

export const MIN_SCHEDULED = 5; // at least five scheduled habit-days…
export const MIN_DAYS = 3; // …spread over at least three days of the week

export function weekStartOf(date) {
  return addDays(date, -dayOfWeek(date));
}

// The most recent week that has fully ended (the one before the current week).
export function lastCompleteWeek(today = todayStr()) {
  return addDays(weekStartOf(today), -7);
}

function longestRun(days) {
  let best = 0;
  let cur = 0;
  days.forEach((x) => { cur = x.done ? cur + 1 : 0; best = Math.max(best, cur); });
  return best;
}

export function computeRecap(habits, weekStart) {
  const weekEnd = addDays(weekStart, 6);
  const perHabit = habits.map((h) => {
    const days = scheduledDays(h, weekStart, weekEnd);
    const done = days.filter((x) => x.done).length;
    return { id: h.id, name: h.name, done, total: days.length, run: longestRun(days), days };
  }).filter((x) => x.total > 0);

  const scheduled = perHabit.reduce((n, x) => n + x.total, 0);
  const done = perHabit.reduce((n, x) => n + x.done, 0);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const perDay = dates.map((date) => {
    let d = 0;
    let s = 0;
    perHabit.forEach((x) => x.days.forEach((y) => { if (y.date === date) { s += 1; if (y.done) d += 1; } }));
    return { date, done: d, scheduled: s };
  });
  const daysWithSchedule = perDay.filter((x) => x.scheduled > 0).length;
  const enough = scheduled >= MIN_SCHEDULED && daysWithSchedule >= MIN_DAYS;

  const bestDay = perDay.reduce((best, x) => (x.done > (best?.done || 0) ? x : best), null);
  const top = perHabit.filter((x) => x.total >= 2 && x.done > 0)
    .sort((a, b) => b.done / b.total - a.done / a.total || b.done - a.done)
    .slice(0, 3)
    .map(({ id, name, done: d, total }) => ({ id, name, done: d, total }));
  const streak = perHabit.reduce((best, x) => (x.run > (best?.run || 0) ? x : best), null);

  // Last week, for an honest comparison (only when it had enough history too).
  const prevStart = addDays(weekStart, -7);
  let prevPct = null;
  const prev = habits.map((h) => scheduledDays(h, prevStart, addDays(prevStart, 6)));
  const prevScheduled = prev.reduce((n, d) => n + d.length, 0);
  if (prevScheduled >= MIN_SCHEDULED) prevPct = Math.round((prev.reduce((n, d) => n + d.filter((x) => x.done).length, 0) / prevScheduled) * 100);

  const backs = comebacks(habits, weekStart, weekEnd);
  const [pattern] = findHabitPatterns(habits, addDays(weekEnd, 1)).filter((p) => p.type !== 'steady');

  // One actionable improvement: a found pattern's option first; otherwise the habit done least
  // often (if under 60%), made smaller; otherwise keep the plan.
  let improvement = { kind: 'keep' };
  if (pattern && pattern.action && pattern.action.kind !== 'edit') {
    improvement = { kind: 'pattern', pattern };
  } else {
    const low = perHabit.filter((x) => x.total >= 3 && x.done / x.total < 0.6)
      .sort((a, b) => a.done / a.total - b.done / b.total)[0];
    if (low) improvement = { kind: 'smaller', habitId: low.id, habitName: low.name, done: low.done, total: low.total };
  }

  return {
    weekStart, weekEnd, enough,
    done, scheduled, pct: scheduled ? Math.round((done / scheduled) * 100) : 0,
    activeDays: perDay.filter((x) => x.done > 0).length,
    perDay,
    bestDay: bestDay && bestDay.done > 0 ? bestDay : null,
    top,
    streak: streak && streak.run >= 2 ? { name: streak.name, days: streak.run } : null,
    perfect: perHabit.filter((x) => x.total >= 3 && x.done === x.total).map((x) => x.name),
    prevPct,
    comebacks: backs,
    pattern: pattern || null,
    improvement,
  };
}

// ---- Seen state: which week's recap was last opened (device-only; drives the Home card) ----
const SEEN_KEY = 'unmet_recap_seen';

export function recapSeen(weekStart) {
  try {
    return localStorage.getItem(SEEN_KEY) === weekStart;
  } catch {
    return true;
  }
}

export function markRecapSeen(weekStart) {
  try {
    localStorage.setItem(SEEN_KEY, weekStart);
  } catch {
    // Not remembered: the card may show again, which is harmless.
  }
}
