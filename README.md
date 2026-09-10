# Unmet — Meet Your Unmet Potential

A personalized, science-backed habit-building web app. No login, no accounts,
no payment screens — everything is stored locally in your browser.

## Run it locally

```bash
npm install
npm run dev
```

Then open the URL it prints (usually `http://localhost:5173`) in your browser.

To build a production version:

```bash
npm run build
npm run preview   # serves the built dist/ folder locally to double-check it
```

## Features

- Calendar-aware habit stacking (manual entry or `.ics` calendar import)
- Morning intention / evening reflection journals
- Free-form journal with an AI-powered "turn into a plan" feature
- Weekly CEO check-in with auto-surfaced pattern insights
- Procrastination breaker / task splitter (Eisenhower matrix)
- Light/dark mode and English/Arabic (RTL) support

## The AI planning feature

`src/lib/aiPlan.js` has a `USE_STUB` flag. While `true`, "Turn into a plan"
uses a local heuristic — no API key needed, works fully offline. Once you
have an Anthropic API key:

1. Add `ANTHROPIC_API_KEY` as an environment variable on your hosting
   provider (see `api/plan.js` for the serverless function it powers).
2. Set `USE_STUB = false` in `src/lib/aiPlan.js`.

Nothing else needs to change.

## Data & privacy

All habits, journal entries, tasks, and calendar events are stored in
`localStorage` in the user's own browser. There is no backend database and
no account system. Settings → Export/Import lets a user back up or move
their data manually.
