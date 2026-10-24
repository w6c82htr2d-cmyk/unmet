const KEYS = {
  profile: 'unmet_profile',
  habits: 'unmet_habits',
  events: 'unmet_events',
  morning: 'unmet_morning',
  evening: 'unmet_evening',
  freeform: 'unmet_freeform',
  goals: 'unmet_goals',
  calendarView: 'unmet_calendar_view',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function todayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function dayOfWeek(dateStr) {
  return new Date(dateStr + 'T00:00:00').getDay();
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function addMinutesToTime(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = ((h * 60 + m + minutes) % (24 * 60) + 24 * 60) % (24 * 60);
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

// ---------- Profile ----------
export function getProfile() {
  return read(KEYS.profile, null);
}

export function saveProfile(profile) {
  write(KEYS.profile, profile);
}

export function isOnboarded() {
  const p = getProfile();
  return !!(p && p.firstName && p.onboarded);
}

// ---------- Calendar view preference ----------
export function getCalendarView() {
  return read(KEYS.calendarView, 'day') === 'week' ? 'week' : 'day';
}

export function setCalendarView(view) {
  write(KEYS.calendarView, view === 'week' ? 'week' : 'day');
}

// ---------- Habits ----------
// habit: { id, name, history: {date: bool}, createdAt,
//   scheduleType: 'independent' | 'stacked',
//   days?: [0-6]             // independent only; absent/empty = every day (legacy default)
//   time?: 'HH:MM'           // independent only
//   duration?: number        // minutes; falls back to DEFAULT_HABIT_DURATION when unset (see habitDuration)
//   stackEventIds?: id[]     // stacked only: links to one or more individual event rows (occurrences)
//   offsetMinutes?: number   // stacked only: minutes after the linked event's end time
//   stackAfter?: string      // legacy free-text label kept for display/history only; not used to schedule
//   needsRelink?: boolean    // set when a stacked habit has no (or no longer valid) linked events
// }
// stackEventIds references individual event rows rather than whole series, so a habit can stack after
// some occurrences of a recurring event and not others (e.g. Classes on Sun+Thu but not Tue); the
// "select all occurrences in this series" picker option just checks every member id at once.
// Scheduling is always computed on the fly from the live event data (habitOccursOnDate/habitTimeForDate)
// rather than cached, so editing or deleting a linked event is reflected immediately with no sync step.

export const DEFAULT_HABIT_DURATION = 20;

function needsHabitMigration(h) {
  return !h.scheduleType || (h.scheduleType === 'stacked' && !h.stackEventIds);
}

function migrateHabitEntry(habit, seriesList) {
  if (habit.scheduleType === 'stacked' && !habit.stackEventIds) {
    // Deployed previously with a single linked series id; expand it to that series' member event ids.
    const m = { ...habit, stackEventIds: habit.stackSeriesId ? getEventSeries(habit.stackSeriesId).map((e) => e.id) : [] };
    delete m.stackSeriesId;
    return m;
  }
  const migrated = { ...habit, scheduleType: 'independent' };
  if (habit.stackAfter) {
    // Legacy stacked habits never stored a real link, only a text label typed by the user. Best-effort:
    // relink automatically only when exactly one event series matches that label; otherwise leave the
    // habit scheduled at its old fixed time and flag it so the UI can offer a safe manual relink.
    const label = habit.stackAfter.trim().toLowerCase();
    const matches = seriesList.filter((s) => s.title.trim().toLowerCase() === label);
    if (matches.length === 1) {
      migrated.scheduleType = 'stacked';
      migrated.stackEventIds = matches[0].members.map((e) => e.id);
      migrated.offsetMinutes = 0;
    } else {
      migrated.needsRelink = true;
    }
  }
  return migrated;
}

export function getHabits() {
  const habits = read(KEYS.habits, []);
  if (!habits.some(needsHabitMigration)) return habits;
  const seriesList = getEventSeriesList();
  let changed = false;
  const migrated = habits.map((h) => {
    if (!needsHabitMigration(h)) return h;
    changed = true;
    return migrateHabitEntry(h, seriesList);
  });
  if (changed) write(KEYS.habits, migrated);
  return migrated;
}

export function saveHabits(habits) {
  write(KEYS.habits, habits);
}

export function addHabit(habit) {
  const habits = getHabits();
  habits.push({
    id: uid(),
    name: habit.name,
    scheduleType: habit.scheduleType || 'independent',
    days: habit.days && habit.days.length ? habit.days : undefined,
    time: habit.time || '',
    duration: habit.duration || DEFAULT_HABIT_DURATION,
    stackEventIds: habit.scheduleType === 'stacked' ? (habit.stackEventIds || []) : undefined,
    offsetMinutes: habit.scheduleType === 'stacked' ? (habit.offsetMinutes ?? 0) : undefined,
    stackAfter: habit.stackAfter || '',
    history: {},
    createdAt: todayStr(),
  });
  saveHabits(habits);
}

// Resolved duration in minutes. Existing habits saved before this field existed simply fall back to
// the default here at read-time — nothing is written back, so their stored record (and completion
// history) is never touched just by reading it.
export function habitDuration(habit) {
  return habit.duration || DEFAULT_HABIT_DURATION;
}

// The live event occurrence (if any) a stacked habit is riding on for a given date — the first linked
// event row that actually occurs that day. Only one occurrence is ever used per date even if several
// linked events happen to match (e.g. overlapping selections), so multi-event stacking can never
// double-schedule a day.
function stackedEventForDate(habit, dateStr) {
  const ids = habit.stackEventIds || [];
  if (!ids.length) return null;
  const events = getEvents();
  for (const id of ids) {
    const ev = events.find((e) => e.id === id);
    if (ev && eventOccursOnDate(ev, dateStr)) return ev;
  }
  return null;
}

export function updateHabit(id, updates) {
  const habits = getHabits();
  const habit = habits.find((h) => h.id === id);
  if (!habit) return;
  Object.assign(habit, updates);
  saveHabits(habits);
}

// Returns what was removed (the stored record, untouched, plus its position) so the caller can
// offer an undo that puts back the exact same habit — streak history included.
export function removeHabit(id) {
  const habits = getHabits();
  const index = habits.findIndex((h) => h.id === id);
  if (index === -1) return null;
  const [habit] = habits.splice(index, 1);
  saveHabits(habits);
  return { habit, index };
}

export function restoreHabit({ habit, index }) {
  const habits = getHabits();
  if (habits.some((h) => h.id === habit.id)) return;
  habits.splice(Math.min(index, habits.length), 0, habit);
  saveHabits(habits);
}

export function toggleHabitForDate(id, dateStr) {
  const habits = getHabits();
  const habit = habits.find((h) => h.id === id);
  if (!habit) return;
  habit.history[dateStr] = !habit.history[dateStr];
  saveHabits(habits);
}

export function toggleHabitToday(id) {
  toggleHabitForDate(id, todayStr());
}

// True only on dates the habit is actually scheduled: for a stacked habit, only dates at least one
// of its linked event series actually occurs on; for an independent habit, only its chosen weekdays
// (or every day, for habits that never set specific days).
export function habitOccursOnDate(habit, dateStr) {
  if (habit.scheduleType === 'stacked') {
    return !!stackedEventForDate(habit, dateStr);
  }
  if (habit.days && habit.days.length) return habit.days.includes(dayOfWeek(dateStr));
  return true;
}

// Resolved HH:MM for a given date, or null if the habit isn't scheduled that day (or every one of
// its links is broken). For stacked habits this is always derived live from the linked event's
// current end time, so an edited or rescheduled event is reflected immediately with no sync step.
export function habitTimeForDate(habit, dateStr) {
  if (habit.scheduleType === 'stacked') {
    const ev = stackedEventForDate(habit, dateStr);
    if (!ev) return null;
    return addMinutesToTime(ev.end, habit.offsetMinutes || 0);
  }
  if (!habitOccursOnDate(habit, dateStr)) return null;
  return habit.time || null;
}

// Resolved end time (start + duration) for a given date, or null if not scheduled that day.
export function habitEndTimeForDate(habit, dateStr) {
  const start = habitTimeForDate(habit, dateStr);
  if (!start) return null;
  return addMinutesToTime(start, habitDuration(habit));
}

// Live titles of every linked event that still resolves (deduped), for display — callers use an
// empty result to show a "relink" affordance for a stacked habit with no working links left.
export function habitLinkedEventTitles(habit) {
  if (habit.scheduleType !== 'stacked') return [];
  const events = getEvents();
  const titles = (habit.stackEventIds || [])
    .map((id) => events.find((e) => e.id === id))
    .filter(Boolean)
    .map((e) => e.title);
  return Array.from(new Set(titles));
}

// Back-compat convenience: first linked title, or null.
export function habitLinkedEventTitle(habit) {
  return habitLinkedEventTitles(habit)[0] || null;
}

// The habit's linked events as live rows (used by the edit UI to show/remove individual selections).
export function habitLinkedEvents(habit) {
  if (habit.scheduleType !== 'stacked') return [];
  const events = getEvents();
  return (habit.stackEventIds || []).map((id) => events.find((e) => e.id === id)).filter(Boolean);
}

export function habitNeedsRelink(habit) {
  if (habit.needsRelink) return true;
  if (habit.scheduleType !== 'stacked') return false;
  const ids = habit.stackEventIds || [];
  if (!ids.length) return true;
  const events = getEvents();
  return ids.some((id) => !events.find((e) => e.id === id));
}

// Habits scheduled on a given date, each annotated with its resolved start/end time for that date,
// sorted by time.
export function habitsForDate(dateStr) {
  return getHabits()
    .filter((h) => habitOccursOnDate(h, dateStr))
    .map((h) => ({ ...h, resolvedTime: habitTimeForDate(h, dateStr), resolvedEndTime: habitEndTimeForDate(h, dateStr) }))
    .sort((a, b) => (a.resolvedTime || '99:99').localeCompare(b.resolvedTime || '99:99'));
}

// Current streak counting only scheduled days: unscheduled days are skipped (never break or extend
// the streak), and today doesn't break an in-progress streak just because it isn't completed yet.
export function habitStreak(habit) {
  let streak = 0;
  let offset = 0;
  if (habitOccursOnDate(habit, todayStr()) && !habit.history[todayStr()]) offset = -1;
  for (let i = 0; i < 400; i++) {
    const date = todayStr(offset);
    if (habit.createdAt && date < habit.createdAt) break;
    if (habitOccursOnDate(habit, date)) {
      if (habit.history[date]) { streak += 1; offset -= 1; } else break;
    } else {
      offset -= 1;
    }
  }
  return streak;
}

// Longest streak ever, using the same scheduled-day logic, scanned forward from the habit's creation.
export function longestHabitStreak(habit) {
  const start = habit.createdAt || todayStr();
  const end = todayStr();
  if (start > end) return 0;
  let longest = 0;
  let current = 0;
  let d = start;
  let guard = 0;
  while (d <= end && guard < 1000) {
    if (habitOccursOnDate(habit, d)) {
      if (habit.history[d]) { current += 1; longest = Math.max(longest, current); } else current = 0;
    }
    d = addDays(d, 1);
    guard += 1;
  }
  return longest;
}

// Past `days` days of completion rate, using each day's actually-scheduled habits as the denominator
// so a day with nothing scheduled shows as "free" (rate: null) instead of a misleading 0%.
export function weeklyConsistency(days = 7) {
  const habits = getHabits();
  const result = [];
  for (let offset = -(days - 1); offset <= 0; offset++) {
    const date = todayStr(offset);
    const scheduled = habits.filter((h) => habitOccursOnDate(h, date));
    const completed = scheduled.filter((h) => h.history[date]);
    result.push({
      date,
      scheduledCount: scheduled.length,
      completedCount: completed.length,
      rate: scheduled.length ? completed.length / scheduled.length : null,
    });
  }
  return result;
}

// Overall completion rate across a window of days (completed / scheduled, pooled across every day —
// not an average of per-day percentages), used for the Consistency (7-day) and Momentum (30-day)
// dashboard metrics. `rate` is null when nothing was scheduled in the whole window (new user), so the
// UI can show an honest empty state instead of a misleading 0%.
export function consistencyRate(days) {
  const daily = weeklyConsistency(days);
  const totalScheduled = daily.reduce((sum, d) => sum + d.scheduledCount, 0);
  const totalCompleted = daily.reduce((sum, d) => sum + d.completedCount, 0);
  return { totalScheduled, totalCompleted, rate: totalScheduled ? totalCompleted / totalScheduled : null };
}

// Next few real occurrences for a stacked habit being created/edited, across all of its (possibly
// several) linked events, for the save-time preview. At most one occurrence per date, even if more
// than one linked event happens to match that date.
export function previewStackedOccurrences(eventIds, offsetMinutes, durationMinutes, count = 6, fromDate = todayStr()) {
  const linked = getEvents().filter((e) => eventIds.includes(e.id));
  const results = [];
  let d = fromDate;
  let guard = 0;
  while (results.length < count && guard < 90) {
    const matched = linked.find((e) => eventOccursOnDate(e, d));
    if (matched) {
      const start = addMinutesToTime(matched.end, offsetMinutes || 0);
      const end = addMinutesToTime(start, durationMinutes || 0);
      results.push({ date: d, start, end, eventTitle: matched.title });
    }
    d = addDays(d, 1);
    guard += 1;
  }
  return results;
}

// Next few occurrences for an independent habit being created/edited, for the same preview.
export function previewIndependentOccurrences(days, time, durationMinutes, count = 6, fromDate = todayStr()) {
  const results = [];
  let d = fromDate;
  let guard = 0;
  while (results.length < count && guard < 90) {
    if (!days || !days.length || days.includes(dayOfWeek(d))) {
      const start = time || null;
      results.push({ date: d, start, end: start ? addMinutesToTime(start, durationMinutes || 0) : null });
    }
    d = addDays(d, 1);
    guard += 1;
  }
  return results;
}

// ---------- Calendar events ----------
// event: { id, seriesId, title, type: 'once'|'weekly', date?: 'YYYY-MM-DD', dayOfWeek?: 0-6,
//          startDate?: 'YYYY-MM-DD', endDate?: 'YYYY-MM-DD', excludeDates?: 'YYYY-MM-DD'[],
//          start: 'HH:MM', end: 'HH:MM', source: 'manual'|'ics' }
// startDate/endDate only apply to weekly events; omitted endDate means it never stops repeating.
// excludeDates lets a single occurrence of a weekly event be edited or removed without touching the
// rest of the series: the date is excluded from the recurring row, and — for an edit — a standalone
// 'once' event carrying the same seriesId is added to stand in for that one date.
// A "series" is the set of events sharing a seriesId: one weekly event covering several weekdays
// (e.g. "Classes" on Sun/Tue/Thu) is stored as one row per weekday, all sharing the same seriesId,
// so a habit can stack after "the series" and follow every real occurrence rather than one weekday.
export function getEvents() {
  return read(KEYS.events, []).map((e) => (e.seriesId ? e : { ...e, seriesId: e.id }));
}

export function saveEvents(events) {
  write(KEYS.events, events);
}

export function addEvent(event) {
  const events = getEvents();
  const id = uid();
  events.push({ id, source: 'manual', seriesId: event.seriesId || id, ...event, id });
  saveEvents(events);
}

export function addEvents(newEvents) {
  const events = getEvents();
  newEvents.forEach((e) => {
    const id = uid();
    events.push({ seriesId: id, ...e, id });
  });
  saveEvents(events);
}

export function removeEvent(id) {
  saveEvents(getEvents().filter((e) => e.id !== id));
}

export function removeEventSeries(seriesId) {
  saveEvents(getEvents().filter((e) => e.seriesId !== seriesId));
}

export function updateEvent(id, updates) {
  const events = getEvents();
  const ev = events.find((e) => e.id === id);
  if (!ev) return;
  Object.assign(ev, updates);
  saveEvents(events);
}

// Apply the same field changes to every *recurring* row of a series — "edit entire series". This
// deliberately skips any standalone 'once' row that shares the seriesId: those exist specifically
// because a single occurrence was detached via updateEventOccurrence, so a series-wide edit should
// not silently clobber that intentional one-off customization (matching how Google Calendar treats
// a detached occurrence as independent of later "all events" edits).
export function updateEventSeries(seriesId, updates) {
  const events = getEvents();
  let changed = false;
  events.forEach((e) => {
    if (e.seriesId === seriesId && e.type === 'weekly') { Object.assign(e, updates); changed = true; }
  });
  if (changed) saveEvents(events);
}

// Edit just the one occurrence on dateStr — "this event only" — leaving the rest of the series
// untouched: exclude that date from the recurring row and stand in a 'once' override carrying the
// same seriesId (so habits stacked on the series keep following this occurrence). Re-editing the
// same occurrence replaces its previous override rather than piling up duplicates.
export function updateEventOccurrence(seriesId, dateStr, updates) {
  const events = getEvents();
  const dow = dayOfWeek(dateStr);
  const original = events.find((e) => e.seriesId === seriesId && e.type === 'weekly' && e.dayOfWeek === dow && eventOccursOnDate(e, dateStr));
  if (!original) return;
  original.excludeDates = original.excludeDates && original.excludeDates.includes(dateStr)
    ? original.excludeDates
    : [...(original.excludeDates || []), dateStr];
  const withoutOldOverride = events.filter((e) => !(e.seriesId === seriesId && e.type === 'once' && e.date === dateStr));
  withoutOldOverride.push({
    id: uid(), seriesId, title: original.title, type: 'once', date: dateStr,
    start: original.start, end: original.end, source: original.source, ...updates,
  });
  saveEvents(withoutOldOverride);
}

// Cancel just the one occurrence on dateStr, leaving the rest of the series scheduled as before.
export function removeEventOccurrence(seriesId, dateStr) {
  const events = getEvents();
  const dow = dayOfWeek(dateStr);
  events.forEach((e) => {
    if (e.seriesId === seriesId && e.type === 'weekly' && e.dayOfWeek === dow && eventOccursOnDate(e, dateStr)) {
      e.excludeDates = [...(e.excludeDates || []), dateStr];
    }
  });
  const filtered = events.filter((e) => !(e.seriesId === seriesId && e.type === 'once' && e.date === dateStr));
  saveEvents(filtered);
}

export function eventOccursOnDate(event, dateStr) {
  if (event.type === 'once') return event.date === dateStr;
  if (event.dayOfWeek !== dayOfWeek(dateStr)) return false;
  if (event.startDate && dateStr < event.startDate) return false;
  if (event.endDate && dateStr > event.endDate) return false;
  if (event.excludeDates && event.excludeDates.includes(dateStr)) return false;
  return true;
}

export function eventsForDate(dateStr) {
  return getEvents()
    .filter((e) => eventOccursOnDate(e, dateStr))
    .sort((a, b) => a.start.localeCompare(b.start));
}

// A "routine" is any recurring (weekly) commitment — classes, work, regular meetings — as opposed
// to a one-off 'once' event. Used to drive the Calendar onboarding guidance.
export function hasRoutines() {
  return getEvents().some((e) => e.type === 'weekly');
}

// All events belonging to the same series (e.g. every weekday row of one recurring event).
export function getEventSeries(seriesId) {
  return getEvents().filter((e) => e.seriesId === seriesId);
}

// One representative entry per series, for pickers: { seriesId, title, members, source }.
export function getEventSeriesList() {
  const seen = new Map();
  getEvents().forEach((e) => {
    if (!seen.has(e.seriesId)) seen.set(e.seriesId, []);
    seen.get(e.seriesId).push(e);
  });
  return Array.from(seen.entries()).map(([seriesId, members]) => ({
    seriesId,
    title: members[0].title,
    source: members[0].source,
    members: members.slice().sort((a, b) => (a.type === 'once' ? a.date.localeCompare(b.date) : a.dayOfWeek - b.dayOfWeek)),
  }));
}

// The specific occurrence (event row) within a series that falls on dateStr, if any.
export function seriesEventForDate(seriesId, dateStr) {
  return getEventSeries(seriesId).find((e) => eventOccursOnDate(e, dateStr)) || null;
}

// ---------- Morning / Evening journal ----------
// morning entry: { date, priorities: [{text, importance, minutes}] }
export function getMorningEntry(date) {
  return read(KEYS.morning, {})[date] || null;
}

export function saveMorningEntry(date, priorities) {
  const all = read(KEYS.morning, {});
  all[date] = { date, priorities };
  write(KEYS.morning, all);
}

export function getAllMorningEntries() {
  return read(KEYS.morning, {});
}

// evening entry: { date, completion: [bool...], obstacle, mood: 1-5 }
export function getEveningEntry(date) {
  return read(KEYS.evening, {})[date] || null;
}

export function saveEveningEntry(date, data) {
  const all = read(KEYS.evening, {});
  all[date] = { date, ...data };
  write(KEYS.evening, all);
}

export function getAllEveningEntries() {
  return read(KEYS.evening, {});
}

// ---------- Free-form journal ----------
// entry: { id, text, createdAt, plan: null | { goals: [...] } }
export function getFreeformEntries() {
  return read(KEYS.freeform, []);
}

export function saveFreeformEntries(entries) {
  write(KEYS.freeform, entries);
}

export function addFreeformEntry(text) {
  const entries = getFreeformEntries();
  const entry = { id: uid(), text, createdAt: new Date().toISOString(), plan: null };
  entries.unshift(entry);
  saveFreeformEntries(entries);
  return entry;
}

export function setFreeformPlan(id, plan) {
  const entries = getFreeformEntries();
  const entry = entries.find((e) => e.id === id);
  if (entry) entry.plan = plan;
  saveFreeformEntries(entries);
}

// ---------- Goals / Task splitter ----------
// goal: { id, text, createdAt, subtasks: [{id, text, importance:'hi'|'lo', urgency:'hi'|'lo', done, lastTouched}] }
export function getGoals() {
  return read(KEYS.goals, []);
}

export function saveGoals(goals) {
  write(KEYS.goals, goals);
}

export function addGoal(goal) {
  const goals = getGoals();
  goals.unshift({ id: uid(), createdAt: new Date().toISOString(), ...goal });
  saveGoals(goals);
  return goals[0];
}

export function toggleSubtask(goalId, subtaskId) {
  const goals = getGoals();
  const goal = goals.find((g) => g.id === goalId);
  if (!goal) return;
  const st = goal.subtasks.find((s) => s.id === subtaskId);
  if (!st) return;
  st.done = !st.done;
  st.lastTouched = new Date().toISOString();
  saveGoals(goals);
}

export function removeGoal(id) {
  saveGoals(getGoals().filter((g) => g.id !== id));
}

// ---------- Export / Import / Reset ----------
export function exportAll() {
  const data = {};
  Object.values(KEYS).forEach((k) => {
    const raw = localStorage.getItem(k);
    if (raw) data[k] = JSON.parse(raw);
  });
  return data;
}

export function importAll(data) {
  Object.values(KEYS).forEach((k) => {
    if (data[k] !== undefined) write(k, data[k]);
  });
}

export function resetAll() {
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
}
