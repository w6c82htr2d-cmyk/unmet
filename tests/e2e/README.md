# Browser tests (Playwright)

End-to-end checks run against a production build with synthetic data only. They never call the
real Anthropic API, Upstash or Supabase: AI endpoints are mocked in the page (`page.route`) or by
`csp-server.mjs`, and `seed.html` fills localStorage with made-up habits, events and goals.

## Run

```bash
npm run build
mkdir -p /tmp/unmet-site && cp -r dist/* tests/e2e/seed.html /tmp/unmet-site/
(cd /tmp/unmet-site && python3 -m http.server 8090) &          # plain static server
node tests/e2e/csp-server.mjs /tmp/unmet-site 8092 &           # same build with vercel.json headers (CSP)
node tests/e2e/cal-e2e.mjs                                     # any suite; each prints "N passed, M failed"
```

The scripts load Playwright from `/opt/node-tools/node_modules` and Chromium from
`/opt/pw-browsers/chromium` (the cloud dev container). Elsewhere, change the `createRequire` path at
the top of a script and the `executablePath`, or install Playwright locally.

| Suite | Covers |
|---|---|
| `t1-e2e` | Home dashboard, check-off + undo, 3-question habit form, edit/delete |
| `cal-e2e` | Calendar Overview, plain-language entry + confirm, routine form, day editing + undo, grouped lists |
| `ob-e2e` | Onboarding: routine step (school/university/work), first habit, no duplicates |
| `ins-e2e` | Habit patterns: counts, confirm-before-change, dismiss, not-enough-history |
| `week-e2e` | Your Week, Unmet: six slides, share PNG, not-enough state |
| `split-e2e` | Task Splitter: AI steps (mocked), personalization, fallbacks, convert to habit/event/task |
| `rem-e2e` | Reminders: opt-in, permission states, due notifications, per-habit mute, iPhone note |
| `journal-e2e` | Journals: drafts, private save, full entries, evening mic + mood labels |
| `tz-e2e` | Dates across time zones, DST, midnight rollover |
| `phase0-test`, `import-e2e`, `event-undo-e2e`, `plan-client-e2e`, `storage-e2e`, `tabs-theme-e2e` | Earlier fixes: backups/import, undo, AI plan client, storage failures, multi-tab, themes |
| `xss-e2e`, `csp-e2e` | Script injection blocked; app works under the production CSP (port 8092) |
| `a11y-audit`, `a11y-states` | Text size, contrast, 44px targets, names and labels on every screen and state |
