# UNMET — Accounts, Sync & Migration Design (for review)

> **Status: Phase A complete (prepared locally, nothing provisioned).** The schema and security
> policies exist as a migration file and pass 43 automated security checks on a local Postgres 16.
> No Supabase project has been created, no migration applied, no data moved and no dependency added.
>
> **Decisions so far:**
> - Supabase approved, subject to this review.
> - Email + guest first; Sign in with Apple when the iOS app is prepared.
> - Journal sync is optional and **off by default**; existing entries are never uploaded without explicit permission; guests keep journals local.
> - Sync codes keep working until the replacement is tested, then are retired in steps.

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

**Recommended sign-in: email + 6-digit code, no password.**

How it works:
- "Create an account" and "Sign in" both ask for an email.
- Supabase emails a one-time code; entering it signs the user in.
- First-time sign-in creates the account. Proving you can read that inbox is the email verification.

Why a code rather than a password or a magic link:
- **No password:** nothing to forget, reuse or leak, and no password-reset flow to build and secure.
- **No magic link:** a link signs in whichever device opens the email. Someone signing up on a laptop who taps the link on their phone ends up signed in on the phone, not the laptop. A code is typed where you are. It also works in the future iOS app without deep-link setup.

Alternative, if the owner prefers passwords: email + password + confirmation email + "Forgot password" reset email. More screens and more to secure, but familiar to users.

**Sessions:**
- Supabase issues a short-lived access token (1 hour by default) and a refresh token with rotation.
- They're stored in the browser, so people stay signed in after refresh and restart.
- **Sign out** revokes the refresh token and clears the session.
- After sign-out the user chooses whether to keep the data on this device (§7).

**Guest mode:** unchanged. No account, data stays local, every feature works.

**Account deletion:**
- A server function (`/api/account-delete`, planned for Phase C) checks the caller's session with Supabase, then deletes that user with the service-role key.
- `on delete cascade` removes all their rows.
- The device copy stays unless "Also erase this device" is chosen.
- An export is offered first.

## 3. Database schema

**Source of truth:** `supabase/migrations/20261030120000_initial_schema.sql` (prepared, not applied).

| Local data (`localStorage`) | Table | Notes |
|---|---|---|
| `unmet_profile` + theme, language, calendar view | `profiles` | Created automatically at signup; includes `journal_sync` (default **false**) |
| `unmet_events` (one row per weekday of a routine) | `events` | Same ids and `series_id`; `exclude_dates` for edited or removed single occurrences |
| `unmet_habits` (without `history`) | `habits` | `stack_event_ids` keep stacked habits linked |
| `habit.history[date]` | `habit_completions` | One row per habit per local day, so two devices completing different days never conflict |
| `unmet_goals` | `goals` | Steps kept as JSON |
| `unmet_morning` / `unmet_evening` / `unmet_freeform` | `journal_entries` | Ids such as `morning:2026-10-30`; **only writable while journal sync is on** |
| (Your Week, Unmet, later) | `weekly_recaps` | Computed metrics only, no journal text |
| (future subscriptions) | `entitlements` | `beta` for everyone; written only by server functions |

**Every record row has:**
- `client_updated_at`: when the user made the change, used to resolve conflicts. The database clamps future clocks so a device with a wrong clock can't keep winning.
- `server_updated_at`: set by the database, used as the "changed since" cursor.
- `deleted_at`: soft delete, so other devices learn about deletions.
- `extra`: size-limited, keeps any fields this schema doesn't model yet, so nothing a device stores is lost in the cloud.

**Validation in the database:**
- id format (safe inside HTML attributes)
- text lengths
- weekday and date types
- event shape (`once` has a date, `weekly` has a weekday)
- JSON size limits
- completions must belong to one of your own habits

## 4. Security policies (Row Level Security)

**Rules:**
- RLS is enabled on every table.
- Signed-in users can only read and write rows where `user_id = auth.uid()`. The user id comes from the signed session token, so a `user_id` sent by the browser is never trusted.
- Nothing is granted to anonymous visitors. Supabase grants table access to them by default, and the migration revokes it.
- Nobody can move a row into another account (a trigger blocks changing `user_id`).
- Profiles can't be deleted directly; they go when the account is deleted.
- Entitlements are read-only for users.
- Journal rows can only be inserted or updated while the user's `journal_sync` is on. Reading and deleting your own entries is always allowed.
- The service-role key (bypasses RLS) is used only in server functions, never in the browser.

**Verified locally:** `sh tests/db/run.sh` applies the migration to a throwaway Postgres 16 with a stand-in for Supabase's roles and `auth.uid()`, then runs 43 checks as two synthetic users, a token without a user, an anonymous visitor and the service role:
- reads, writes, updates and deletes across accounts
- forged `user_id`
- journal opt-in on and off
- self-granted subscriptions
- invalid data
- clock clamping
- account-deletion cascade

All pass. Breaking a policy on purpose (RLS off, journal check removed, anonymous access left on) makes the matching checks fail, so the tests do detect mistakes.

**Still to verify on the real project (Phase E):** the same checks through Supabase's actual API with real tokens for two test accounts.

## 5. Sync design (adapted to the current code)

**The device stays the working copy.** Pages keep reading `localStorage` synchronously, so no page needs rewriting.

**Recording changes (outbox):**
- Every save already goes through one function, `db.js` `write()`.
- There the new value is compared with the old one by record id, and each changed or deleted record is added to an outbox with the time of the change.
- Completions are compared per habit and date.
- No caller changes; the existing local data format stays the same.

**Push:**
- Upload outbox entries in batches as upserts, with `client_updated_at` = the time of the change.
- An entry leaves the outbox **only after the server confirms it**.
- Failures keep it queued and retry with back-off.

**Pull:**
- Fetch rows changed since the last cursor, minus a small overlap so a slow transaction can't be skipped.
- Applying them is idempotent.

**Conflicts:**
- Same record changed on two devices: the later `client_updated_at` wins.
- A local change still waiting in the outbox is never overwritten by an older remote one.
- Completions merge per habit and day.
- Journals (when synced): if both sides changed one entry, the losing version is kept as a separate "conflicted copy" instead of being discarded.

**When it syncs:** on start-up, when the tab regains focus, about 2 seconds after a change, every 60 seconds while visible, and when the connection returns. Real-time push is unnecessary for now.

**Status:** a small indicator ("Synced", "Syncing…", "Offline: changes saved on this device", "Couldn't sync, retrying") that **never says "Synced" before the server has confirmed**.

**Streaks and stats:** computed on each device from the same synced completion history, so they match everywhere. They aren't stored.

**Security policy update needed in Phase B:** `connect-src` must allow `https://<project>.supabase.co`.

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

## 9. Setting up the Supabase test project (owner steps)

Use a **separate test project**. Nothing here touches production, which stays guest-only. Dashboard
labels may differ slightly from the names below.

1. **Create the project.** At supabase.com choose New project, name it e.g. `unmet-test`, on the Free plan.
   - Pick the region closest to your testers.
   - Choose a strong database password and keep it in your password manager. **Don't send it to anyone, including me.**
2. **Turn on email codes.** Go to Authentication → Sign In / Providers → Email:
   - Email provider **on**
   - "Confirm email" **on**
   - **Email OTP length: 6**
   - **Email OTP expiration: 600 seconds** (10 minutes)
3. **Make the emails show the code.** Go to Authentication → Email Templates. Edit **both** "Confirm signup" (sent to new users) and "Magic Link" (sent to returning users):
   - Replace the link with the code, e.g. *"Your UNMET code is **{{ .Token }}**. It expires in 10 minutes. If you didn't ask for it, you can ignore this email."*
   - Remove `{{ .ConfirmationURL }}`, because UNMET doesn't use links.
4. **URL settings.** Under Authentication → URL Configuration, set the Site URL to your Vercel preview address. Codes don't need redirect URLs.
5. **Email sending for testing.** The built-in sender is rate-limited and meant for testing. It may only deliver to the email addresses of your Supabase team members. Test with your own address, or invite test addresses to the project team. A custom email provider (e.g. Resend) is needed before real users.
6. **Rate limits.** Keep Supabase's defaults under Authentication → Rate Limits. They limit code emails and verification attempts per IP. CAPTCHA (Attack Protection) can come later; it needs a security-policy change.
7. **Copy the two public values.** From Project Settings → API Keys:
   - the **Project URL** (`https://<ref>.supabase.co`)
   - the **Publishable key** (`sb_publishable_…`; on older projects, the "anon public" key)
   - **Never copy the secret / service_role key into the app, a message or the repo.**
8. **Add them to Vercel, Preview only.** In Vercel go to Project → Settings → Environment Variables:
   - add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
   - select **Preview** only, not Production
   - production builds then keep accounts switched off
9. **Send me the Project URL and the publishable key.** Both are designed to be public; Row Level Security protects the data. I'll add exactly that URL to `connect-src` in `vercel.json` (the build refuses to run otherwise), then you can open a preview deployment and test.
10. **Not yet:** the service-role key (only needed by server functions in Phase C, stored as a *Sensitive* Vercel variable) and applying the database migration. Both need approval at the start of Phase C.

**Verifying on the real test project** (you do this, because only you receive the emails):
1. On the preview, choose Create an account and enter your email. The email arrives with a 6-digit code, and entering it signs you in.
2. A wrong code shows an error. "Send a new code" unlocks after 60 seconds.
3. Refresh the page, then close and reopen the browser: you're still signed in (Settings → Account).
4. Sign out: Settings shows guest again and your data is unchanged.
5. Sign in on a second device or browser with the same email. (Your habits won't appear there yet; automatic sync is Phase C.)
6. Repeat once in Arabic.
