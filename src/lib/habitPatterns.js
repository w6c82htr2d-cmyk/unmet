// Habit patterns found only in the user's own check-in history. Every insight is a count the user
// can verify ("done on 0 of the last 4 Mondays"), needs a minimum amount of history before it
// appears, and never guesses at reasons or feelings. Suggestions are practical options the user
// can take or ignore; any change to a habit happens only after they confirm it.
import { habitOccursOnDate, todayStr, addDays, dayOfWeek } from '../db.js';

export const WINDOW_DAYS = 28; // look back four weeks
export const MIN_HISTORY_DAYS = 14; // no patterns until there are two weeks of scheduled days

// Scheduled days for one habit in [from, to], oldest first: { date, dow, done }. Days before the
// habit existed, and days it isn't scheduled, are left out (never counted as misses).
export function scheduledDays(habit, from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (habit.createdAt && d < habit.createdAt) continue;
    if (!habitOccursOnDate(habit, d)) continue;
    out.push({ date: d, dow: dayOfWeek(d), done: !!(habit.history && habit.history[d]) });
  }
  return out;
}

const rate = (days) => (days.length ? days.filter((x) => x.done).length / days.length : 0);
const doneCount = (days) => days.filter((x) => x.done).length;

// How much history exists at all (distinct past days with any scheduled habit), so the app can say
// "not enough yet" honestly instead of showing a weak pattern.
export function historyDays(habits, today = todayStr()) {
  const end = addDays(today, -1);
  const from = addDays(today, -WINDOW_DAYS);
  const dates = new Set();
  habits.forEach((h) => scheduledDays(h, from, end).forEach((x) => dates.add(x.date)));
  return dates.size;
}

// All patterns, strongest first. Each: { id, type, habitId, habitName, ...numbers, action? }.
// Today is excluded (it isn't over yet).
export function findHabitPatterns(habits, today = todayStr()) {
  const end = addDays(today, -1);
  const from = addDays(today, -WINDOW_DAYS);
  const found = [];
  if (historyDays(habits, today) < MIN_HISTORY_DAYS) return found;

  habits.forEach((h) => {
    const days = scheduledDays(h, from, end);
    if (days.length < 8) return;

    // 1. One weekday that clearly lags the rest: at least 3 of that weekday, at most a third done,
    //    while the other days are at least two-thirds done.
    for (let dow = 0; dow < 7; dow++) {
      const on = days.filter((x) => x.dow === dow);
      const off = days.filter((x) => x.dow !== dow);
      if (on.length >= 3 && off.length >= 6 && rate(on) <= 1 / 3 && rate(off) >= 2 / 3) {
        const canSkip = h.scheduleType !== 'stacked' && (!h.days || h.days.length > 1);
        found.push({
          id: `weekday:${h.id}:${dow}`, type: 'weekday', habitId: h.id, habitName: h.name, dow,
          onDone: doneCount(on), onTotal: on.length, offDone: doneCount(off), offTotal: off.length,
          score: (rate(off) - rate(on)) * 3,
          action: canSkip ? { kind: 'skipDay', dow } : { kind: 'edit' },
        });
      }
    }

    // 2. A recent slide: the last 7 days well below the 3 weeks before.
    const weekAgo = addDays(today, -7);
    const recent = days.filter((x) => x.date >= weekAgo);
    const before = days.filter((x) => x.date < weekAgo);
    if (recent.length >= 3 && before.length >= 6 && rate(before) - rate(recent) >= 0.4) {
      const duration = h.duration || 0;
      found.push({
        id: `slide:${h.id}:${today}`, type: 'slide', habitId: h.id, habitName: h.name,
        recentDone: doneCount(recent), recentTotal: recent.length, beforeDone: doneCount(before), beforeTotal: before.length,
        score: (rate(before) - rate(recent)) * 2,
        action: duration > 5 ? { kind: 'shorten', minutes: Math.max(5, Math.round(duration / 2 / 5) * 5) } : { kind: 'edit' },
      });
    }

    // 3. A steady habit worth noticing (not when the same habit just got a weekday or slide note).
    if (days.length >= 10 && rate(days) >= 0.85 && !found.some((f) => f.habitId === h.id)) {
      found.push({
        id: `steady:${h.id}`, type: 'steady', habitId: h.id, habitName: h.name,
        done: doneCount(days), total: days.length, score: rate(days) * 0.5,
      });
    }
  });

  // 4. Linked vs. not linked: only when both groups have real history and differ clearly.
  const linked = [];
  const unlinked = [];
  habits.forEach((h) => (h.scheduleType === 'stacked' ? linked : unlinked).push(...scheduledDays(h, from, end)));
  if (linked.length >= 10 && unlinked.length >= 10 && rate(linked) - rate(unlinked) >= 0.2) {
    const candidates = habits.filter((h) => h.scheduleType !== 'stacked')
      .map((h) => ({ h, days: scheduledDays(h, from, end) }))
      .filter((c) => c.days.length >= 5)
      .sort((a, b) => rate(a.days) - rate(b.days));
    if (candidates.length) {
      found.push({
        id: `linked:${candidates[0].h.id}`, type: 'linked', habitId: candidates[0].h.id, habitName: candidates[0].h.name,
        linkedPct: Math.round(rate(linked) * 100), unlinkedPct: Math.round(rate(unlinked) * 100),
        score: rate(linked) - rate(unlinked) + 0.3,
        action: { kind: 'edit' },
      });
    }
  }

  return found.sort((a, b) => b.score - a.score);
}

// "Comeback" moments: a habit done again after two or more missed scheduled days in a row, within
// [from, to]. Used by the weekly recap; counts only, no commentary.
export function comebacks(habits, from, to) {
  const out = [];
  habits.forEach((h) => {
    const days = scheduledDays(h, addDays(from, -WINDOW_DAYS), to);
    let missedRun = 0;
    days.forEach((x) => {
      if (!x.done) { missedRun += 1; return; }
      if (missedRun >= 2 && x.date >= from) out.push({ habitId: h.id, habitName: h.name, date: x.date, missedBefore: missedRun });
      missedRun = 0;
    });
  });
  return out;
}

// ---- Dismissed insights: per device, not part of the export; each comes back after 4 weeks ----
const DISMISS_KEY = 'unmet_insights_dismissed';

function readDismissed() {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function isDismissed(id, today = todayStr()) {
  const when = readDismissed()[id];
  return typeof when === 'string' && addDays(when, WINDOW_DAYS) > today;
}

export function dismissInsight(id, today = todayStr()) {
  const all = readDismissed();
  all[id] = today;
  // Forget old entries so this never grows without bound.
  Object.keys(all).forEach((k) => { if (typeof all[k] !== 'string' || addDays(all[k], WINDOW_DAYS) <= today) delete all[k]; });
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(all));
  } catch {
    // Not remembered: the insight may show again, which is harmless.
  }
}

export function activeHabitPatterns(habits, today = todayStr()) {
  return findHabitPatterns(habits, today).filter((p) => !isDismissed(p.id, today));
}
