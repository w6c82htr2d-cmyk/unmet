// AI planning feature: turns a free-form journal entry into a structured plan.
//
// USE_STUB toggles between the local heuristic (no API key needed) and a
// real call to /api/plan (a serverless function that talks to the
// Anthropic API, using the ANTHROPIC_API_KEY environment variable on the
// host). Now false: the app calls the real API.
const USE_STUB = false;

const HABIT_WORDS = ['learn', 'read', 'practice', 'daily', 'everyday', 'every day', 'meditate', 'exercise', 'run', 'running', 'gym', 'stretch', 'journal', 'sleep', 'workout', 'walk'];
const DEADLINE_WORDS = ['by december', 'by january', 'by february', 'by march', 'by april', 'by may', 'by june', 'by july', 'by august', 'by september', 'by october', 'by november', 'deadline', 'due', 'asap', 'this week', 'this month', 'finish', 'complete', 'submit'];
const HIGH_IMPORTANCE_WORDS = ['thesis', 'job', 'application', 'exam', 'gpa', 'grade', 'finish', 'career', 'interview', 'graduate', 'graduation'];

function splitIntoGoals(text) {
  const cleaned = text.replace(/\band\b/gi, ',');
  return cleaned
    .split(/[,.;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3)
    .slice(0, 6);
}

function classify(goalText) {
  const lower = goalText.toLowerCase();
  const isHabitLike = HABIT_WORDS.some((w) => lower.includes(w));
  const hasDeadline = DEADLINE_WORDS.some((w) => lower.includes(w));
  const isHighImportance = HIGH_IMPORTANCE_WORDS.some((w) => lower.includes(w)) || hasDeadline;

  const importance = isHighImportance ? 'high' : (isHabitLike ? 'low' : 'medium');
  const urgency = hasDeadline ? 'high' : 'low';

  let firstStep;
  if (hasDeadline && !isHabitLike) {
    firstStep = { type: 'calendar', label: 'Schedule blocks on your calendar for this' };
  } else if (isHabitLike) {
    firstStep = { type: 'stack', label: 'Stack a small daily version after an existing habit' };
  } else {
    firstStep = { type: 'task', label: 'Send to Task Splitter for concrete next steps' };
  }

  return { importance, urgency, firstStep };
}

function stubPlan(text) {
  const goalTexts = splitIntoGoals(text);
  const goals = goalTexts.length
    ? goalTexts.map((g, i) => ({ id: `g${i}`, text: capitalize(g), ...classify(g) }))
    : [{ id: 'g0', text: capitalize(text.slice(0, 60)), ...classify(text) }];
  return { goals, source: 'stub' };
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function realPlan(text) {
  const res = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error('AI planning request failed');
  const data = await res.json();
  return { ...data, source: 'ai' };
}

export async function planFromJournal(text) {
  if (USE_STUB) {
    // small artificial delay so the "generating" state is visible in the UI
    await new Promise((r) => setTimeout(r, 500));
    return stubPlan(text);
  }
  return realPlan(text);
}

export function isStubActive() {
  return USE_STUB;
}
