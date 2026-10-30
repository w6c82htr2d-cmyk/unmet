# UNMET — Accounts, Sync & Migration Design (for review)

> **Status: design only.** Nothing here is implemented or set up: no Supabase project, no
> dependency, no stored data is changed. It needs the owner's approval before any build.
>
> **Decisions so far:**
> - Supabase is preferred.
> - Email + guest first; Sign in with Apple when the iOS app is prepared.
> - The migration strategy is approved in principle, but not the migration itself.
> - Journal sync is **optional** for signed-in users; guests keep journals on their device.

## 1. Is Supabase a good fit?

| Requirement | How Supabase fits | Verdict |
|---|---|---|
| Works with the current app (vanilla JS, local-first, Vercel) | `@supabase/supabase-js` works in the browser. `localStorage` stays the app's working copy; a separate sync layer talks to Supabase. Pages keep reading data synchronously, so no rewrite. | ✅ |
| Email sign-in without passwords | Email one-time **code** (6 digits) and magic link. A code is preferred: it also works inside a future iOS app without deep-link setup. | ✅ (needs custom SMTP, below) |
| Guest mode | Guests simply don't sign in, as today. Supabase "anonymous users" are **not** needed. | ✅ |
| Per-user data isolation enforced on the server | Postgres **Row Level Security**: every table only returns or accepts rows where `user_id = auth.uid()`, enforced by the database even if the browser code is altered. | ✅ |
| Offline | supabase-js has no offline sync, which is fine: the app already works offline and the sync layer pushes queued changes when back online. | ✅ (we own the sync logic) |
| Future iOS (Capacitor) | supabase-js runs in the WebView. Sessions can be stored in the iOS Keychain through a custom storage adapter. Native Sign in with Apple through a plugin + `signInWithIdToken`. | ✅ |
| Future subscription status | A separate table writable only by server functions (service role), readable by its owner. | ✅ |
| Privacy | Choice of hosting region at project creation. Data encrypted at rest. Open source with a standard Postgres export, so there's a way out. | ✅ (see §6) |
| Cost | Free tier: 50,000 monthly active users and a 500 MB database, plenty for beta. **Free projects pause after about a week without activity**, which is a risk for a quiet beta. Pro is $25/month. | ⚠️ |
| Email delivery | The built-in email sender is rate-limited and meant for testing. Production needs a custom SMTP provider (e.g. Resend, free up to 3,000 emails/month) with SPF/DKIM records on getunmet.com. | ⚠️ |

**Verdict:** appropriate for UNMET now and for the iOS plan. The two ⚠️ items are operational
(pausing, SMTP), not architectural.

**New dependency at build time:** `@supabase/supabase-js`, the project's first runtime dependency (tens of KB gzipped).

**Environment variables:**
- `SUPABASE_URL` and `SUPABASE_ANON_KEY`: public by design, safe in the browser because Row Level Security does the protecting.
- `SUPABASE_SERVICE_ROLE_KEY`: server functions only, never in the browser.

## 2. Accounts

- **Sign-in screen:** "Continue with email" (enter email → enter 6-digit code), and "Continue as guest" with equal visual weight. No Apple button until the iOS phase.
- **Sessions:** Supabase access token (short-lived) + refresh token, kept by supabase-js. "Sign out" clears them.
- **Recovery:** with no password there's nothing to reset. Losing the email account means losing access, so this is stated plainly in the UI.
- **Account deletion:** a server function (service role) deletes the auth user. `on delete cascade` removes every row. The device copy stays unless "Also erase this device" is chosen.

## 3. Database schema (proposal)

Design rules:
- Every row carries `user_id`.
- Client ids are kept as they are, because stacked habits reference event ids. The primary key is `(user_id, id)`.
- Every row has `client_updated_at` (device time, used for conflict resolution) and `server_updated_at` (set by the database, used as the "changed since" cursor).
- Deletions are soft (`deleted_at`) so other devices learn about them.

```sql
-- Shared: keep server_updated_at honest (clients can't set it).
create or replace function public.touch_server_updated_at() returns trigger
language plpgsql as $$ begin new.server_updated_at := now(); return new; end $$;

create table public.profiles (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  first_name         text check (char_length(first_name) <= 100),
  goal_tracks        text[] not null default '{}',
  journal_sync       boolean not null default false,          -- opt-in, see §6
  client_updated_at  timestamptz not null default now(),
  server_updated_at  timestamptz not null default now()
);

create table public.events (
  user_id            uuid not null references auth.users(id) on delete cascade,
  id                 text not null check (id ~ '^[A-Za-z0-9_.:@-]{1,100}$'),
  series_id          text not null check (series_id ~ '^[A-Za-z0-9_.:@-]{1,100}$'),
  title              text not null check (char_length(title) between 1 and 500),
  type               text not null check (type in ('once', 'weekly')),
  date               date,
  day_of_week        smallint check (day_of_week between 0 and 6),
  start_date         date,
  end_date           date,
  exclude_dates      date[] not null default '{}',
  start_time         time not null,
  end_time           time not null,
  source             text not null default 'manual',
  client_updated_at  timestamptz not null,
  server_updated_at  timestamptz not null default now(),
  deleted_at         timestamptz,
  primary key (user_id, id),
  check ((type = 'once' and date is not null) or (type = 'weekly' and day_of_week is not null))
);

create table public.habits (
  user_id            uuid not null references auth.users(id) on delete cascade,
  id                 text not null check (id ~ '^[A-Za-z0-9_.:@-]{1,100}$'),
  name               text not null check (char_length(name) between 1 and 500),
  schedule_type      text not null default 'independent' check (schedule_type in ('independent', 'stacked')),
  days               smallint[],                       -- null = every day
  time               time,
  duration_min       smallint not null default 15 check (duration_min between 1 and 600),
  stack_event_ids    text[] not null default '{}',     -- references events.id (same user), kept even if broken
  offset_minutes     smallint not null default 0,
  created_on         date not null,
  client_updated_at  timestamptz not null,
  server_updated_at  timestamptz not null default now(),
  deleted_at         timestamptz,
  primary key (user_id, id)
);

-- One row per habit per day, so two devices completing different days never conflict.
create table public.habit_completions (
  user_id            uuid not null,
  habit_id           text not null,
  day                date not null,                    -- the user's local calendar date
  done               boolean not null,
  client_updated_at  timestamptz not null,
  server_updated_at  timestamptz not null default now(),
  primary key (user_id, habit_id, day),
  foreign key (user_id, habit_id) references public.habits (user_id, id) on delete cascade
);

create table public.goals (
  user_id            uuid not null references auth.users(id) on delete cascade,
  id                 text not null check (id ~ '^[A-Za-z0-9_.:@-]{1,100}$'),
  text               text not null check (char_length(text) <= 2000),
  subtasks           jsonb not null default '[]',
  created_at         timestamptz not null default now(),
  client_updated_at  timestamptz not null,
  server_updated_at  timestamptz not null default now(),
  deleted_at         timestamptz,
  primary key (user_id, id)
);

-- Only written when profiles.journal_sync = true (checked by the policy below, not just the app).
create table public.journal_entries (
  user_id            uuid not null references auth.users(id) on delete cascade,
  id                 text not null check (id ~ '^[A-Za-z0-9_.:@-]{1,100}$'),
  kind               text not null check (kind in ('morning', 'evening', 'freeform')),
  day                date,                             -- morning/evening entries are per day
  body               jsonb not null,
  client_updated_at  timestamptz not null,
  server_updated_at  timestamptz not null default now(),
  deleted_at         timestamptz,
  primary key (user_id, id)
);

create table public.weekly_recaps (
  user_id            uuid not null references auth.users(id) on delete cascade,
  week_start         date not null,
  data               jsonb not null,                   -- computed metrics only, no journal text
  created_at         timestamptz not null default now(),
  primary key (user_id, week_start)
);

-- Future subscription status. Clients can read their own row; only server functions write it.
create table public.entitlements (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  state              text not null default 'beta' check (state in ('beta', 'trialing', 'active', 'grace', 'paused')),
  trial_started_at   timestamptz,
  trial_ends_at      timestamptz,
  server_updated_at  timestamptz not null default now()
);

-- Triggers for server_updated_at on every table that has it (same pattern for each):
create trigger touch_events before insert or update on public.events
  for each row execute function public.touch_server_updated_at();
-- … likewise for profiles, habits, habit_completions, goals, journal_entries, entitlements.

create index on public.events (user_id, server_updated_at);
create index on public.habits (user_id, server_updated_at);
create index on public.habit_completions (user_id, server_updated_at);
create index on public.goals (user_id, server_updated_at);
create index on public.journal_entries (user_id, server_updated_at);
```

## 4. Row Level Security policies

```sql
-- Every user table: RLS on, nothing for the anonymous role, own rows only for signed-in users.
alter table public.profiles          enable row level security;
alter table public.events            enable row level security;
alter table public.habits            enable row level security;
alter table public.habit_completions enable row level security;
alter table public.goals             enable row level security;
alter table public.journal_entries   enable row level security;
alter table public.weekly_recaps     enable row level security;
alter table public.entitlements      enable row level security;

revoke all on all tables in schema public from anon;

-- Pattern applied to profiles, events, habits, habit_completions, goals, weekly_recaps:
create policy "own rows - read"   on public.events for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "own rows - insert" on public.events for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "own rows - update" on public.events for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows - delete" on public.events for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Journals: same, but writes are refused unless the user has opted in to journal sync.
create policy "journals - read"  on public.journal_entries for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "journals - write" on public.journal_entries for insert to authenticated
  with check ((select auth.uid()) = user_id
              and exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.journal_sync));
create policy "journals - update" on public.journal_entries for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id
              and exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.journal_sync));
create policy "journals - delete" on public.journal_entries for delete to authenticated
  using ((select auth.uid()) = user_id);   -- deleting is always allowed

-- Entitlements: read own only. No insert/update/delete policies, so only the service role
-- (server functions handling Stripe/App Store notifications later) can change them.
create policy "entitlements - read own" on public.entitlements for select to authenticated
  using ((select auth.uid()) = user_id);
```

**How isolation gets verified (before anything ships):**
- A dedicated test project with two synthetic users, A and B.
- Scripted calls with A's token try to:
  - read B's rows
  - insert rows with `user_id = B`
  - update B's rows
  - change their own entitlement
  - write journals while `journal_sync = false`
- Every attempt must fail.
- The same checks run with the anon key and no session.

## 5. Sync design

- **The device stays the source for the UI.** Writes go to `localStorage` as today and are queued as "changed since last sync".
- **Push:** upsert changed rows (`client_updated_at` = device time of the edit). Deletions push `deleted_at`.
- **Pull:** fetch rows where `server_updated_at > last_pull_cursor`, then apply them.
- **Conflicts:**
  - Same record edited on two devices: the later `client_updated_at` wins.
  - **Completions** merge per habit and day.
  - For legacy data with no timestamps, a completed day always wins over not-completed, so no completion is ever lost.
  - **Journals:** if both sides changed the same entry, the losing version is kept as a separate "conflicted copy" entry instead of being discarded.
- **Offline:** the queue persists. Sync runs at start-up, when the connection returns, and after edits (debounced).

## 6. Journal sync: privacy and security implications

Guests and signed-in users who don't opt in keep journals **only on their device**, as today.

**If a signed-in user turns journal sync on:**
- **Where it lives:** entries are stored in the Supabase project's region, encrypted at rest by the provider, and isolated per user by Row Level Security.
- **Who could technically read it:**
  - the user, from any signed-in device
  - Supabase as the hosting provider (processor)
  - **anyone with admin access to the UNMET Supabase project**, i.e. the owner. That's true of standard (non end-to-end) encryption and has to be stated honestly in the privacy policy.
- **Backups:** on paid plans, Supabase keeps daily backups. Deleted entries can stay in backups until they expire. The policy should state the retention period.
- **Breach impact:** journals are the most sensitive data UNMET holds. If the service-role key leaked, synced journals would be exposed. Mitigations:
  - the key only in Vercel server env vars
  - least-privilege dashboard access with two-factor authentication on the Supabase account
  - no analytics or AI processing of synced journal text
- **AI planning is separate:** using "Turn into a plan" sends that text to Anthropic whether or not sync is on.
- **Turning it off:** sync stops, and the user can delete the cloud copies. Device copies stay.

**Stronger option for later: end-to-end encrypted journals.**
- Entries are encrypted on the device with a key derived from a separate journal passphrase.
- The server, and the owner, only ever see ciphertext.
- Trade-offs:
  - a forgotten passphrase means unrecoverable entries
  - there's no server-side search
  - more work on iOS (keychain-held key)
- **Recommendation:** launch accounts with journal sync **off by default** and clearly labelled. Offer end-to-end encryption if testers want journal sync.

## 7. Guest → account migration (approved in principle, not implemented)

1. **Backup first.** Before any account step: a local snapshot (the existing backup from `src/lib/backup.js`) plus an offered download. Restorable for 30 days.
2. **Summary + consent.** "On this device: 5 habits, 12 routines, 118 completed days, 30 journal entries, 2 goals. Upload to your account?" There are separate toggles for journals, off unless journal sync is chosen.
3. **Upload rules:**
   - additive upserts that can be safely repeated
   - existing ids kept, so stacked-habit links survive
   - the server returns row counts per table, and the device is marked synced only if they match
   - **local data is never deleted**
4. **The account already has data:**
   - **Merge:** combine everything by id; possible duplicates (same name and schedule) are listed for review, never auto-removed.
   - **Use the account's data on this device:** local data goes into the backup first.
   - **Keep this device separate:** stay a guest.
   - Cloud data is never overwritten without explicit confirmation.
5. **Id collisions** with different content (very unlikely, but possible across devices): the incoming record gets a new id and links are remapped. The user is told.
6. **Sync-code users:** offered "Bring in my sync-code data" during migration. Sync codes keep working until accounts are stable.

**Scenario tests required before the migration ships** (synthetic snapshots):

| # | Scenario | Expected result |
|---|---|---|
| 1 | New account, guest data present | Upload; counts match; local unchanged |
| 2 | New account, no guest data | Nothing to upload; empty account |
| 3 | Existing account + different guest data | Merge offered; union of records; links intact |
| 4 | Existing account + identical data (same ids) | No duplicates; no changes |
| 5 | Same habit name/schedule, different ids | Listed as possible duplicate; nothing removed |
| 6 | Stacked habits pointing at events | Links still resolve after upload and on a second device |
| 7 | Legacy habits (no `createdAt`/`duration`), broken links | Uploaded; defaults applied at read time as today |
| 8 | Large journal set near the storage limit | Uploads in batches; resumable after interruption |
| 9 | Upload interrupted halfway (offline) | Resumes; no duplicates; not marked synced until counts match |
| 10 | Two devices edit the same habit / complete different days | Later edit wins; both completions kept |
| 11 | Journal sync off | No journal rows written (policy refuses even a forced request) |
| 12 | Choose "Use account data" | Local snapshot in backup first; restore works |
| 13 | Account deleted | All cloud rows gone; device data untouched unless erase chosen |

## 8. Costs

| Item | Beta | Later |
|---|---|---|
| Supabase | Free (pauses when idle) | Pro $25/month (no pausing, daily backups) |
| Email (Resend) | Free, 3,000 emails/month | about $20/month beyond |
| Apple Developer Program | Not needed yet | $99/year at the iOS phase |
