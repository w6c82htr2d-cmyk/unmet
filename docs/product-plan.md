# UNMET — Product & Codebase Audit and Phased Plan

> Status: **living plan.** Phase 0, Phase 0b and the `/api/plan` hardening are *done*. Everything else
> is a proposal awaiting approval. UNMET is in beta: no payments, paywall, trial countdown or subscription prompts, and every
> feature stays free.
>
> Sources: the Final Product Development & UX Improvement Brief, the earlier UI/UX audit, and the
> code on branch `claude/unmet-website-build-se4jge`. The pitch deck and the raw user feedback were
> not attached, so the brief's descriptions of them are used instead.

**Product journey this plan serves:** Set a goal → Understand your routine → Build a habit → Take
action → Track progress → Recognize patterns → Improve next week.

---

## 1. Codebase audit

| Area | What exists today |
|---|---|
| Stack | Vite + vanilla JS single-page app, hash router, full `innerHTML` re-render per page. **Zero runtime dependencies.** Deployed on Vercel. |
| Storage | `localStorage` only (`src/db.js`): profile, habits (with completion history), events, morning, evening, freeform, goals, calendar view. Theme, language, tour flag and sync code are stored in separate keys. No schema version, no `updatedAt` timestamps, no deletion markers. |
| Authentication | **None.** No accounts and no sessions. |
| Cross-device | Manual "sync code": `/api/sync` stores the whole export as one blob in Upstash Redis under a random code. Anyone with the code can read or overwrite it, it is stored unencrypted (journals included), and it **expires after 6 months** without a push. Pull replaces local data after a confirmation. |
| Calendar | Day view (drag to create, drag to move) and Week view (horizontal scroll). Weekly routines with start/end dates, one-time events, edit or delete a single occurrence or the whole series. The Week view misalignment is fixed (Phase 0, *done*). |
| Habit stacking | Stacked habits link to one or more events or series. Time = linked event's **end** time + 0/10/30 min. Duration, upcoming-occurrence preview, a warning when a link breaks, editing that keeps history. No "before" option and no start-time anchor. |
| Habits / Home | Daily ring, 7-day and 30-day rings, 7-day bar chart, streaks (unscheduled days are skipped, which is correct), suggested stack, Undo on delete (*done*). |
| Journals | Morning Intention, Evening Reflection, Free-form journal with speech-to-text. "Turn into a plan" calls **live AI** through `/api/plan`. |
| Task Splitter | **Keyword templates, not AI** (`src/lib/taskSplitter.js`). Three templates (study, fitness, career). Anything else falls back to generic advice such as "Tell one person about this goal", which matches the user complaint exactly. Eisenhower matrix, stalled-step nudge, speech-to-text. |
| Patterns | `src/lib/patterns.js` only looks at morning priorities that were marked missed in the evening on the same weekday, with a threshold of 2. It does **not** use habit history. Shown on a single `/insight` page. |
| Weekly review | **Not built.** It appears in `design/Unmet_App_Wireframes.html` only. |
| Reminders / PWA | None: no service worker, no manifest, no notifications. |
| AI integration | `api/plan.js` calls Anthropic with the key from the `ANTHROPIC_API_KEY` env var. **No login and no rate limit on the endpoint.** Credentials will not be touched. |
| Settings | Name, goals, theme, language, export, import, reset, sync code, help. No account section. |
| i18n | English + Arabic (RTL), 290 keys each, both complete. |

## 2. Existing vs missing (against the brief)

| Brief part | Status |
|---|---|
| P2 Calendar bugs | *Done:* Week alignment, stale subtitle, routine success card on mobile, Undo for habit, event and goal deletes, time-zone date bug, safe import, accessibility (text, contrast, 44px targets, labels, focus, reduced motion), dark default. **Still open (Phase 2):** long Day view, date strip above the schedule, truncated titles, three overlapping add buttons, routines listed once per weekday. |
| P3 Login & accounts | Missing entirely. |
| P4 Onboarding | Partly there: name → goals → routine guidance and a 3-step indicator exist. Missing: free-text goal, the routine prompt after *every* new routine, and the hand-off to Home. |
| P5 Calendar | Day/Week exist. Missing: compact Day Overview, natural-language routine entry, a single "+ Add", grouped routines, safe event delete. |
| P6 Habit stacking | Mostly there. Missing: the 3-question flow, "before" a routine, start-time anchor, custom offsets, progressive disclosure. |
| P7 Task Splitter | Concept and matrix exist. Missing: concrete AI breakdown, "What's making this difficult?", and Add as Task / Make it a Habit / Schedule in Calendar. |
| P8 Completion | Toggle and streaks exist. Missing: clear checkboxes, undo message, per-habit 7-day history, and showing scheduled / done / missed / unscheduled differently. |
| P9 Journals | All three exist and will be kept. Only readability work planned. |
| P10 Patterns | A weak version exists (priorities only). Needs to work on habit history, with minimum-observation rules and practical adjustments. |
| P11 Your Week, Unmet | Missing. Will replace `/insight` and the unbuilt "weekly review". |
| P12 Reminders | Missing. |
| P13 Dashboard | Exists but overloaded: 4 overlapping progress visuals, emoji, text under 11px. Light is the default theme today; dark default for new users is still to do. |
| P14 / P15 | Planning only (see `docs/business-model.md` and §6 Phase 6). |

## 3. Highest-priority problems

1. **Dates go wrong outside UTC (critical, newly found).** `todayStr()` and `addDays()` turn local dates into UTC strings. Verified in the browser with fixed clocks:
   - **Saudi Arabia (UTC+3), all day:** Week view shows **Oct 16–22 on Sat Oct 24**, a week that doesn't contain today. `addDays(d, 1)` returns `d` itself, so the longest-streak calculation stalls and some streak and preview math is wrong.
   - **Saudi Arabia, 00:00–03:00:** the app still thinks it's yesterday, and check-offs are saved to the previous day.
   - **New York, after 20:00:** the app thinks it's tomorrow, check-offs are saved to tomorrow, and Week view jumps to next week.
   - Testing ran in UTC, which hid it. This probably explains some "confusing calendar" feedback.
2. **New users get lost after adding events.** The routine → habit step only appears after the *first* routine, and the habit form asks too much at once.
3. **Calendar is hard to use on phones.** A long hourly grid, a week strip above a single day, three add buttons, truncated titles, and every routine listed once per weekday.
4. **Task Splitter output is generic** for any goal outside its three templates.
5. **Completing a habit doesn't feel clear or satisfying.** There are no checkbox affordances, no per-habit history, and a missed day looks like a reset.
6. **Data safety gaps.** Import overwrites everything without confirmation, deleting an event has no undo, sync-code data expires silently after 6 months and is stored unencrypted, and there are no automatic backups.
7. **Accessibility.** Text at 8–10px, contrast failures, sub-44px targets, no `aria-label`s, no focus styles, and reduced motion is ignored.
8. **The open AI endpoint** can be scripted to spend Anthropic credit.

## 4. Recommended authentication architecture

**Recommendation: Supabase** (Auth + Postgres with Row Level Security), with `localStorage` staying
the app's working copy and a new sync layer on top.

| Criterion | Supabase (recommended) | Firebase (good alternative) |
|---|---|---|
| Sign-in methods | Email magic link or code, Apple, linking an existing account | Email link, Apple |
| Per-user isolation on the server | Postgres **Row Level Security** (`user_id = auth.uid()`), enforced in the database | Firestore security rules |
| Fit with UNMET data | Relational tables suit habits, completions and future subscription data well | Document store; good offline SDK, but its async reads would mean rewriting every page |
| Privacy / exit path | Open source; standard Postgres export | Proprietary |
| Future iOS (Capacitor) | Works; native Sign in with Apple via a plugin | Works; mature Capacitor plugin |
| Future subscription status | Simple tables written by server functions | Collections written by the Admin SDK |
| Free tier | 50k monthly active users, 500 MB database. **Free projects pause after about 7 days without activity**, which is a real risk in a quiet beta. | Generous; no pausing |
| Email sending | Built-in sender is for testing only, so a free SMTP provider is needed (e.g. Resend) | Free email links included |

If no pausing and no extra email provider matters more than relational data and an exit path,
choose Firebase. The rest of this plan works with either.

**Account design:**
- **Guest mode stays exactly as today:** local only, no server account, no restrictions.
- **Sign-in options:** Continue with Apple (needs the Apple Developer Program), Continue with email (magic link or 6-digit code), Continue as Guest. Sessions use the provider's secure refresh tokens.
- **Account recovery:** email login has no password to forget. Apple accounts recover through Apple.
- **The login screen** uses the brief's copy: "Meet your unmet potential." / "Build habits that fit your life. Keep your progress wherever you go." It's dark by default with the existing blue accent, and "Continue as Guest" has equal visual weight.
- **Database tables**, all protected by Row Level Security:
  - `profiles`
  - `habits`
  - `habit_completions`, one row per habit per date, so completions merge cleanly between devices
  - `events`
  - `journal_entries` (kind: morning / evening / freeform)
  - `goals`
  - `weekly_recaps`
  - every row carries `updated_at` and `deleted_at`
- **Syncing:** push local changes since the last sync, then pull remote changes. The newest record wins, except completions, which merge per habit and date. Works offline and syncs when the connection returns.
- **Journal privacy:** the provider encrypts data at rest and Row Level Security keeps it per user. A setting will let people keep journals on this device only. End-to-end encryption is possible later.
- **Secrets stay server-side.** Only the public "anon" key ships to the browser, as the provider intends.
- **Future subscription status:** a separate table written only by server functions (see `docs/business-model.md`).
- **The existing sync codes keep working during beta.** Retiring them comes later, after accounts are stable.

## 5. Safe guest-data migration

Nothing moves to the cloud until this strategy is approved.

1. **Automatic backup first.** Before any account step, save a timestamped local snapshot of the full export and offer it as a download. Keep it for 30 days with a "Restore backup" button.
2. **New account, no data in the cloud yet.** Show a summary: *"On this device: 5 habits, 12 routines, 118 completed days, 30 journal entries, 2 goals. Upload to your account?"* The choices are **Upload** or **Not now** (stay local).
   - The upload adds data and can be safely repeated: records keep their existing ids, so stacked-habit links survive.
   - Afterwards the server confirms the counts. The device is only marked "synced" if the counts match.
   - **Local data is never deleted.**
3. **Existing account that already has data, plus guest data on this device.** Show both summaries and three choices:
   - **Merge:** combine everything by id. Possible duplicates (same name and schedule) are listed for the user to review and are never removed automatically.
   - **Use my account's data on this device:** local data goes into a backup file first, then the cloud copy is used.
   - **Keep this device separate:** stay a guest.
   - Cloud data is **never overwritten without explicit confirmation**.
4. **Completion history that has no timestamps** is merged as a union of completed days, so a completion is never lost.
5. **Signing out** asks whether to keep a copy on this device. Removing it is only offered once everything has synced.
6. **Account deletion** removes the account and all cloud rows immediately. Data on the device stays unless the user also chooses "erase this device". The screen explains exactly what happens and offers an export first.
7. **Tests use synthetic snapshots** covering: legacy habits without `createdAt`, broken stacked links, large journals, duplicates, and two devices editing the same record.

## 6. Phased implementation plan

Each phase is separate commits, tested on its own, and pushed to the feature branch only. Nothing
goes to production without approval.

| Phase | Contents | Approval needed for |
|---|---|---|
| **0** | Week alignment, routine success on mobile, habit delete Undo, stale subtitle | *Done* |
| **0b — Critical fixes** *(done)* | **Time-zone date fix** (local-date helpers everywhere). Confirmation plus automatic backup before importing a file. Undo for event and series deletion. Dark default for new users (existing light choices kept). Accessibility foundations: text ≥11px, 4.5:1 contrast, 44px targets, `aria-label`s, focus styles, reduced motion. Stale README and help text. | Approved and done. See `docs/security-audit.md`. |
| **1a — Local data hardening** | Schema version, `updatedAt`/`deletedAt` on records, automatic local backups. Groundwork for sync. | Storage change |
| **1b — Accounts & sync** | Provider setup, login screen, Apple + email + guest, sync layer, migration flow (§5), account section in Settings (export, delete, sign out) | Provider choice, Apple Developer account, email provider, migration strategy |
| **2 — Onboarding, calendar, habit creation** | Goal step (choose or type), routine step, "Your routine is set!" after **every** new routine. **Compact Day Overview** as the default on phones (chronological agenda), with the hourly timeline one tap away. One "+ Add" (Routine / One-time). Natural-language quick entry with a deterministic parser and a confirmation preview. Routines grouped as "Classes · Sun, Tue, Thu · 08:00–10:50". No more truncated titles. Habit form as 3 questions (what / how long / when), with "before or after a routine", start/end anchor and custom offset hidden until needed. | Go-ahead |
| **3 — Task Splitter** | New `/api/split` function (separate file; `api/plan.js` untouched; same key and model) returning concrete steps with completion criteria and durations, ordered smallest-first, with matrix labels. Optional "What's making this difficult?" + free text. Each step: **Add as Task / Make it a Habit / Schedule in Calendar**, pre-filled and confirmed before saving. The templates stay as an offline fallback. Speech-to-text kept. | New AI endpoint and its cost; rate limiting |
| **4 — Habit experience & dashboard** | Home order: greeting → today's habits (big checkboxes, one tap, subtle animation, Undo) → daily progress → streaks → weekly consistency → one insight. Per-habit 7-day dots that tell **done, missed and not-scheduled** apart. Encouraging "4 of last 5" framing next to streaks. New pattern engine on habit history: deterministic rules, minimum observations, dismissible, explainable, no AI calls. Fewer, clearer charts; no emoji. | Go-ahead |
| **5 — Your Week, Unmet** | Weekly metrics in the local time zone that respect scheduled days and handle edited or deleted habits. Six animated slides: Review → Wins → Patterns → Comeback (only when the data supports it) → One Thing to Improve (applied only after confirmation) → Keep Becoming (share image with no journal text or calendar details). Subtle Home card, history of past weeks. Replaces `/insight`. No AI needed. | Go-ahead |
| **6 — Reminders & iOS prep** | Evaluate reminders. Write the Capacitor iOS architecture plan (below). | Any paid scheduling service |

**Reminders:**
- **Websites can't reliably notify at a set time when they're closed.** Real push needs a service worker plus a server scheduler.
- **iPhones only allow web push for sites added to the Home Screen** (iOS 16.4+).
- **Proposal:** optional reminders while UNMET is open now. Proper per-habit reminders arrive with the iOS app as **on-device local notifications** (free, no server).
- **Web push** stays a later option (it needs a scheduler such as Upstash QStash; free tier first).

**Capacitor iOS notes (planning only):**
- **Reuse the existing frontend.** It is already a static Vite build, which suits Capacitor well.
- **Safe areas:** the bottom nav needs `env(safe-area-inset-*)` padding.
- **Speech-to-text:** move to a native plugin; WKWebView doesn't support the Web Speech API reliably.
- **Notifications:** use native local notifications.
- **Sign in with Apple:** use the native flow.
- **Keychain:** store session tokens there.
- **Offline:** already local-first.
- **App Store requirements:** a privacy "nutrition label", in-app account deletion, and an app that feels native rather than a wrapped website.

**Order note:** Phases 2, 4 and 5 only use local data. They can go ahead while the account
provider and migration plan (1a/1b) are being decided.

## 7. Technical risks and dependencies

| Risk | Mitigation |
|---|---|
| Records saved under shifted dates by the time-zone bug can't be identified and corrected safely | Fix going forward; leave past history untouched. Mention it in release notes. |
| Data loss during migration or sync | Backups first, additive uploads, count checks, never deleting local data, confirmations before overwriting |
| Supabase free project pausing during a quiet beta | Accept for beta, or Pro at $25/month; or choose Firebase |
| Email deliverability | Custom SMTP (Resend free tier); verified domain records on getunmet.com |
| Apple sign-in needs a paid developer account and domain setup | Ship email + guest first; add Apple once the account exists |
| `localStorage` is about 5 MB (journals grow) | Monitor size; IndexedDB later if needed |
| Pages fully re-render (state can get lost, animations are harder) | Keep vanilla JS; isolate the Your Week, Unmet slides as a self-contained module; no framework rewrite |
| AI endpoints open to scripting | Per-IP rate limit (Upstash, already in use) on `/api/split`; same for `/api/plan` once approved; Anthropic Console spend limit |
| Sync-code data unencrypted and expiring | Document it in the app now; retire after accounts launch |
| Vercel Hobby plan is for non-commercial use | Fine during beta; Vercel Pro once monetized |
| Business model | Settled: 10-day full-access trial, then a paid subscription, no free tier (`docs/business-model.md`). Not active during beta. |

## 8. Cost of new services

| Service | Needed for | Cost |
|---|---|---|
| Supabase | Accounts, sync | Free tier ($0; pauses when idle); Pro $25/month |
| — or Firebase | Accounts, sync | Free (Spark) for beta-scale use |
| Resend (SMTP, Supabase path) | Login emails | Free 3,000/month (100/day); about $20/month beyond |
| Apple Developer Program | Sign in with Apple, future iOS app | $99/year |
| Anthropic (existing key) | Task Splitter AI | About $0.003 per breakdown; about $3 per 1,000 breakdowns |
| Upstash Redis (existing) | Rate limiting | Free tier |
| Natural-language routine parsing, patterns, Your Week, Unmet | Local, deterministic | $0 |
| Vercel | Hosting | Hobby free now; Pro $20/month per member when commercial |

## 9. Testing strategy

- **Unit tests** with Node's built-in `node --test`, so no new dependency. They cover the pure functions: date helpers in several time zones, streaks, consistency, stacking occurrences, the natural-language parser, the weekly metrics and the pattern rules.
- **Playwright end-to-end tests** on synthetic seeded data (the existing seed page):
  - phone and desktop, dark and light, English and Arabic RTL
  - **time zones UTC, Riyadh, New York and Tokyo**, plus a daylight-saving changeover
  - fixed clocks around midnight
- **Flows** to cover:
  - guest use, routine create and edit, stacking, habit edit (history kept)
  - completion + Undo, deletion + Undo, all three journals kept
  - Task Splitter → Task / Habit / Calendar with confirmation
  - Your Week, Unmet with no data, a partial week, and a full week
- **Accounts** use a separate test project and two synthetic users:
  - signup, login, logout, session persistence
  - **direct API calls proving user A can't read or write user B's rows**
  - migration of each snapshot type, and two-device conflicts
- **AI quality:** a fixed set of about 20 goals ("Learn French", "Improve my GPA", …) scored against a checklist: specific, measurable, timed, no generic advice, no invented resources. About $0.06 per run, and only run with approval.
- **Accessibility:** contrast and target-size checks with the Taste inspector, keyboard-only navigation, screen-reader labels.
- **Never against real user data.** No secrets in tests or logs.

## 10. Decisions

**Made (2026-10-30):**
- Phase 0b approved and done.
- `/api/plan` hardening approved and done (model, key and responses unchanged).
- Supabase preferred: schema, policies and migration design are in `docs/auth-architecture.md`, for review. Not implemented.
- Email + guest first; Sign in with Apple at the iOS phase.
- Migration strategy approved in principle; the migration itself is not approved yet.
- Journal sync is optional for signed-in users; guests keep journals on their device.
- Business model: 10-day full-access trial, then subscription; nothing active in beta.

**Still open:**
1. Review `docs/auth-architecture.md`: schema, RLS, migration and journal-sync implications.
2. Approve fixes from `docs/security-audit.md` (sync-code hardening, security headers/CSP, storage-full handling, privacy page, dev-dependency updates).
3. Approve the AI Task Splitter endpoint (Phase 3), now that `/api/plan` is secured.
4. Approve Phase 2 (onboarding, calendar, habit creation).
