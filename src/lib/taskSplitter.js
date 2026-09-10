const TEMPLATES = [
  {
    match: ['gpa', 'grade', 'study', 'exam', 'class', 'course', 'thesis', 'homework', 'assignment', 'lecture'],
    subtasks: [
      ['Review your most recent lecture notes', 'hi', 'hi'],
      ['Finish the assignment or problem set due soonest', 'hi', 'hi'],
      ['Email your professor or TA about anything confusing', 'lo', 'hi'],
      ['Review the syllabus for upcoming deadlines', 'hi', 'lo'],
      ['Book a library or study room for a focused block', 'lo', 'lo'],
      ['Organize your notes from the last week', 'lo', 'lo'],
    ],
  },
  {
    match: ['gym', 'fitness', 'workout', 'run', 'exercise', 'weight', 'muscle'],
    subtasks: [
      ['Pick 3 days this week and put workouts on your calendar', 'hi', 'hi'],
      ['Lay out your gym clothes and bag tonight', 'lo', 'hi'],
      ['Follow a simple starter routine for your first session', 'hi', 'lo'],
      ['Set one measurable check-in date 4 weeks out', 'hi', 'lo'],
      ['Track today’s meals just to build awareness', 'lo', 'lo'],
      ['Find a workout buddy or class for accountability', 'lo', 'lo'],
    ],
  },
  {
    match: ['job', 'application', 'resume', 'cv', 'interview', 'career', 'internship'],
    subtasks: [
      ['Update your resume with your most recent experience', 'hi', 'hi'],
      ['Pick 3 postings to apply to this week', 'hi', 'hi'],
      ['Ask one person for a reference or introduction', 'lo', 'hi'],
      ['Draft a reusable cover letter template', 'hi', 'lo'],
      ['Set up job alerts for your target roles', 'lo', 'lo'],
      ['Practice one common interview question out loud', 'lo', 'lo'],
    ],
  },
];

const GENERIC = [
  ['Write down exactly what "done" looks like for this', 'hi', 'hi'],
  ['Pick the smallest possible first action and do it today', 'hi', 'hi'],
  ['Block 25 minutes on your calendar to work on this', 'hi', 'lo'],
  ['Identify what usually stops you from starting', 'lo', 'hi'],
  ['Tell one person about this goal for accountability', 'lo', 'lo'],
  ['Set a review date one week from now', 'lo', 'lo'],
];

export function quadrant(importance, urgency) {
  if (importance === 'hi' && urgency === 'hi') return 'doNow';
  if (importance === 'hi' && urgency === 'lo') return 'schedule';
  if (importance === 'lo' && urgency === 'hi') return 'quickWin';
  return 'dropLater';
}

export function splitGoal(goalText) {
  const lower = goalText.toLowerCase();
  const template = TEMPLATES.find((t) => t.match.some((kw) => lower.includes(kw)));
  const rows = template ? template.subtasks : GENERIC;
  return rows.map(([text, importance, urgency], i) => ({
    id: `st${i}`,
    text,
    importance,
    urgency,
    done: false,
    lastTouched: new Date().toISOString(),
  }));
}

const STALL_DAYS = 3;

export function findStalledSubtask(goal) {
  const now = Date.now();
  const stalled = goal.subtasks
    .filter((s) => !s.done)
    .filter((s) => (now - new Date(s.lastTouched).getTime()) / 86400000 >= STALL_DAYS)
    .sort((a, b) => (quadrant(a.importance, a.urgency) === 'quickWin' ? -1 : 1));
  return stalled[0] || null;
}
