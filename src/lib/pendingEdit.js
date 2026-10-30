// Tiny cross-page handoff: Calendar lets you tap a habit block to edit it, but the full habit
// editor lives on Home (duration, days, stacking, etc. — no need to duplicate that whole form here).
// Calendar calls requestHabitEdit(id) then navigates to '/'; Home checks consumePendingHabitEdit()
// on render and opens straight into editing that habit.
let pendingHabitEditId = null;

export function requestHabitEdit(id) {
  pendingHabitEditId = id;
}

export function consumePendingHabitEdit() {
  const id = pendingHabitEditId;
  pendingHabitEditId = null;
  return id;
}

// Same idea, for the "+ Add Habit" entry points on Calendar: opens Home straight into the add-habit
// form, optionally with a set of event ids pre-selected as the stacking anchor (e.g. right after
// creating a routine). An empty eventIds array just opens the form with nothing preselected.
let pendingAddHabit = null;

// prefill: optional { name, duration } (e.g. a Task Splitter step turned into a habit).
export function requestAddHabit(eventIds = [], prefill = {}) {
  pendingAddHabit = { eventIds, prefill };
}

export function consumePendingAddHabit() {
  const v = pendingAddHabit;
  pendingAddHabit = null;
  return v;
}

// "Add a routine" from elsewhere (e.g. the habit form when there are no routines yet): opens the
// Calendar straight into the routine form, optionally pre-filled ({ title, minutes, date }).
let pendingAddRoutine = null;

export function requestAddRoutine(prefill = {}) {
  pendingAddRoutine = { ...prefill };
}

export function consumePendingAddRoutine() {
  const v = pendingAddRoutine;
  pendingAddRoutine = null;
  return v;
}

// "Schedule in Calendar" from a Task Splitter step: opens the one-time event form pre-filled.
let pendingAddEvent = null;

export function requestAddEvent(prefill = {}) {
  pendingAddEvent = { ...prefill };
}

export function consumePendingAddEvent() {
  const v = pendingAddEvent;
  pendingAddEvent = null;
  return v;
}
