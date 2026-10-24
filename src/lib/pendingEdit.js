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
