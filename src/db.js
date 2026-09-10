const KEYS = {
  profile: 'unmet_profile',
  habits: 'unmet_habits',
  events: 'unmet_events',
  morning: 'unmet_morning',
  evening: 'unmet_evening',
  freeform: 'unmet_freeform',
  goals: 'unmet_goals',
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

// ---------- Habits ----------
export function getHabits() {
  return read(KEYS.habits, []);
}

export function saveHabits(habits) {
  write(KEYS.habits, habits);
}

export function addHabit({ name, stackAfter }) {
  const habits = getHabits();
  habits.push({ id: uid(), name, stackAfter: stackAfter || '', history: {}, createdAt: todayStr() });
  saveHabits(habits);
}

export function removeHabit(id) {
  saveHabits(getHabits().filter((h) => h.id !== id));
}

export function toggleHabitToday(id) {
  const habits = getHabits();
  const habit = habits.find((h) => h.id === id);
  if (!habit) return;
  const today = todayStr();
  habit.history[today] = !habit.history[today];
  saveHabits(habits);
}

export function habitStreak(habit) {
  let streak = 0;
  let offset = 0;
  // if today isn't done yet, streak counts from yesterday backward
  if (!habit.history[todayStr()]) offset = -1;
  while (habit.history[todayStr(offset)]) {
    streak += 1;
    offset -= 1;
  }
  return streak;
}

// ---------- Calendar events ----------
// event: { id, title, type: 'once'|'weekly', date?: 'YYYY-MM-DD', dayOfWeek?: 0-6, start: 'HH:MM', end: 'HH:MM', source: 'manual'|'ics' }
export function getEvents() {
  return read(KEYS.events, []);
}

export function saveEvents(events) {
  write(KEYS.events, events);
}

export function addEvent(event) {
  const events = getEvents();
  events.push({ id: uid(), source: 'manual', ...event });
  saveEvents(events);
}

export function addEvents(newEvents) {
  const events = getEvents();
  newEvents.forEach((e) => events.push({ id: uid(), ...e }));
  saveEvents(events);
}

export function removeEvent(id) {
  saveEvents(getEvents().filter((e) => e.id !== id));
}

export function eventsForDate(dateStr) {
  const dow = dayOfWeek(dateStr);
  return getEvents()
    .filter((e) => (e.type === 'once' && e.date === dateStr) || (e.type === 'weekly' && e.dayOfWeek === dow))
    .sort((a, b) => a.start.localeCompare(b.start));
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
