# Unmet — Meet Your Unmet Potential

A personalized habit-building web app, currently in beta. No login, no accounts and no payment
screens: everything is stored locally in your browser, and every feature is free during beta.

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

## Tests

```bash
npm test
```

Runs the unit suites (Node's built-in test runner, no extra dependencies) once per time zone:
UTC, Asia/Riyadh, America/New_York and Asia/Tokyo. Date bugs only show up away from UTC. The
`/api/plan` tests mock every network call, so they never reach Anthropic or Upstash.

## Features

- Calendar with Day and Week views, weekly routines and one-time events
- Habit stacking: build habits on top of existing routines
- Morning intention, evening reflection and a free-form journal with voice dictation
- AI "Turn into a plan" for free-form journal entries
- Task Splitter (Eisenhower matrix)
- Light/dark mode (dark by default for new users) and English/Arabic (RTL)

## The AI planning feature

`api/plan.js` is a Vercel serverless function that calls the Anthropic API with the
`ANTHROPIC_API_KEY` environment variable set on the host. The key never reaches the browser. The
endpoint is rate limited per client and globally (`PLAN_DAILY_LIMIT`, default 2000 per day), using
the Upstash Redis connection that sync codes already use. It validates input and returns generic
errors. Shared protection code lives in `api/_lib/guard.js`.

Optional environment variables: `PLAN_DAILY_LIMIT`, `RATE_LIMIT_SALT`, `ALLOWED_ORIGINS`
(comma-separated extra origins, e.g. a custom preview domain).

## Data & privacy

Habits, journal entries, tasks and calendar events are stored in `localStorage` in the user's own
browser. Data leaves the device only when the user:

- turns a journal entry into a plan (the text goes to Anthropic),
- uses a sync code (the data goes to Upstash), or
- uses voice dictation (the browser's speech service processes the audio).

Settings → Export/Import backs up or moves data. An import is validated and previewed first, and
the current data is saved as a backup that can be restored.

## Planning documents

- `docs/product-plan.md`: product audit and phased plan
- `docs/security-audit.md`: security, privacy and reliability findings
- `docs/auth-architecture.md`: proposed accounts, sync and migration design (not implemented)
- `docs/business-model.md`: future subscription model (not active during beta)
