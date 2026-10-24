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

export function requestAddHabit(eventIds = []) {
  pendingAddHabit = { eventIds };
}

export function consumePendingAddHabit() {
  const v = pendingAddHabit;
  pendingAddHabit = null;
  return v;
}
