# UNMET — Security, Privacy & Reliability Audit

**Date:** 2026-10-30
**Scope:** branch `claude/unmet-website-build-se4jge`, after Phase 0b and the `/api/plan` hardening.

**Method:**
- Code review of `src/`, `api/`, `index.html` and `package.json`.
- Local tests with **synthetic data only**: Node unit tests and Playwright (Chromium).
- `npm audit`.
- No requests to the production site, no real user records, no real AI or Upstash traffic. All API tests mock the network.
- Mapped to OWASP Top 10 (2021) and the OWASP API Security Top 10 (2023) where relevant.

**Severity:**
- **Critical:** exploitable now, with serious data or cost impact
- **High:** realistic exploit, significant impact
- **Medium:** needs specific conditions, or limited impact
- **Low:** hardening or hygiene

## Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| F1 | Stored XSS through the profile name in an imported file or sync-code payload | High | **Fixed** (40b22be) |
| F2 | Backup import overwrote data without validation, confirmation or backup | High | **Fixed** (aef0517) |
| F3 | `/api/plan` open to unlimited scripted use (Anthropic cost) and leaked error details | High | **Fixed** (20c3495) |
| F4 | Sync codes: bearer secret with no rate limit, plaintext journals, overwritable, silent 6-month expiry | **High** | Open, recommendation below |
| F5 | No Content-Security-Policy or security headers on the site | Medium | Open |
| F6 | Storage-full errors are unhandled: a check-off or entry silently isn't saved | Medium | Open |
| F7 | No privacy policy, though journal text goes to Anthropic (AI planning), Upstash (sync) and Google/Apple (dictation) | Medium | Open |
| F8 | Journals stored in plaintext in `localStorage` (shared devices, browser extensions) | Medium | Accepted for beta, mitigations below |
| F9 | Date handling saved completions under the wrong day outside UTC | High (integrity) | **Fixed** (af619b8). Past shifted records left as they are, by decision. |
| F10 | Deleting events or goals could not be undone | Medium (integrity) | **Fixed** (5e54324, 1435bdd) |
| F11 | `/api/sync` returns internal error details (`String(err)`) | Low | Open |
| F12 | Dev-only dependency advisories (esbuild dev server, source-map-js) | Low | Open; needs approval to update dependencies |
| F13 | Google Fonts loaded from Google's servers on every visit (IP disclosed to a third party) | Low | Open |
| F14 | Site can be framed (no `frame-ancestors`) | Low | Open; covered by the F5 headers |
| F15 | A second open tab shows stale data until it re-renders (no lost writes) | Low | Open |
| F16 | `index.html` starts as `data-theme="light"`, so dark-mode users see a brief flash | Low | Open |
| F17 | The IP-based rate limit can be spread across many IPs | Low (residual) | Mitigated by the global cap; recommend the Anthropic Console spend limit |

**Secrets:**
- No API keys, tokens or credentials in the source, the built bundle (`dist/`), or git history (searched for `sk-ant`, `ANTHROPIC_API_KEY` values, `UPSTASH`).
- `ANTHROPIC_API_KEY` and the Upstash credentials are read only by server functions.

**Dependencies:**
- **Zero runtime dependencies.** The shipped bundle is first-party code only.
- `npm audit --omit=dev` reports 0 vulnerabilities.

## Fixed findings

### F1 — Stored XSS through profile name (High, fixed)
**OWASP:** A03 Injection.

**Evidence:**
- `src/pages/home.js` rendered `${profile?.firstName}` into `innerHTML` without escaping.
- On the previous build, importing `{"unmet_profile":{"firstName":"<img src=x onerror=\"window.__pwned=1\">"}}` and opening Home **ran the script** (`xss-e2e`: `script executed = true`). On the fixed build: `false`.
- The same payload could arrive through a sync-code pull from anyone who knew the code.
- Script in UNMET's origin can read every journal in `localStorage`.

**Fix:**
- The name is escaped.
- Import and sync validation now also rejects:
  - ids that could break out of an HTML attribute
  - non-date `startDate`/`endDate` values
  - malformed AI plans
  - names over 100 characters
- `escapeAttr` now escapes `&`, `"` and `<` everywhere.
- A sweep of every template found the other user strings already escaped.

### F2 — Unsafe backup import (High, fixed)
**OWASP:** A08 Software & Data Integrity.

**Before:** choosing a file immediately overwrote matching sections, with no validation, confirmation or backup. A malformed file could leave the app unusable.

**Now:**
- Every section is validated against the export schema before anything is written (a bad file changes nothing). There's a 5 MB cap.
- A preview compares the file with the data on the device.
- Import only happens on explicit confirmation.
- The current data is backed up locally first, or downloaded if storage is full.
- One-tap Restore, which itself can be undone.
- Sync-code pulls go through the same validation and backup.

**Tests:** 9 unit tests and 13 browser checks.

### F3 — `/api/plan` abuse and information leakage (High, fixed)
**OWASP:** API4 Unrestricted Resource Consumption, A05 Misconfiguration.

**Before:**
- No rate limit, so anyone could script requests and spend Anthropic credit.
- Error responses returned the upstream error body, raw model output and exception strings.

**Now:**
- **Rate limits per client:** 10 per 10 minutes and 40 per day. Clients are identified by a salted hash of the IP.
- **Global daily cap:** default 2,000, set with `PLAN_DAILY_LIMIT`.
- **If Upstash is missing or down,** an in-memory limiter still applies.
- **Strict validation:** POST only, JSON content type, string `text` up to 20,000 characters.
- **Origin check** as defence in depth only.
- **25-second upstream timeout.**
- **Generic error messages with codes.** Logs hold metadata only (a test proves no journal text or key appears).
- **Daily usage counters.**
- **Unchanged:** model, prompt, `max_tokens`, 4,000-character truncation and the success response. Tests verify this.

**Tests:** 13 unit tests, all network calls mocked.

### F9 — Time-zone date bug (High integrity, fixed)
- "Today" was computed in UTC.
- In Riyadh after midnight, check-offs were saved to the previous day, and Week view showed the wrong week all day.
- In New York evenings, "today" was tomorrow.

**Fix:** local-date helpers and UTC-free date arithmetic.

**Evidence:**
- 100 browser checks across UTC, Riyadh, New York and Tokyo, including daylight-saving changes and midnight.
- The old code fails 49 of them; the new code passes all 100.
- Unit suites run under all four zones.
- As decided, completions already saved under shifted dates were **not** rewritten.

### F10 — Irreversible deletes (Medium integrity, fixed)
- Deleting a habit, an event (single occurrence, whole series, or from the list) or a goal now offers Undo.
- Undo restores the exact stored records in their original position, so stacked-habit links come back.

## Open findings and recommendations

### F4 — Sync codes (High)
**OWASP:** A01 Broken Access Control, A04 Insecure Design, API4.

**Evidence (`api/sync.js`, `src/lib/sync.js`):**
- **The code is the only credential.** Anyone who has it can read the full export, journals included, or overwrite it (`push` replaces the stored blob).
- **No rate limit or failed-attempt tracking** on `pull`. Codes are 8 characters from a 32-letter alphabet (about 40 bits), and the server accepts any `[A-Z0-9]{6,12}`. Guessing a valid code takes many requests, but nothing slows an attacker down. `push` also lets anyone store up to 2 MB under arbitrary codes, which can fill the shared Upstash database.
- **Data is stored unencrypted** in Upstash.
- **Silent expiry:** data expires 6 months after the last push, without warning. People who think of a sync code as a backup can lose it.
- **Current mitigation:** pulls are now validated and backed up locally before applying (F1/F2), so a malicious overwrite can't inject script or destroy local data unseen.

**Recommendations, needing approval:**
1. **Rate-limit `/api/sync`** with the same guard as `/api/plan`: per-IP limits on pulls and pushes, and a stricter limit on pulls of codes that don't exist.
2. **Require 12-character codes** (about 60 bits) for new codes; keep accepting existing 8-character ones.
3. **Encrypt the blob in the browser** with a key derived from the code, so Upstash and anyone with database access only see ciphertext.
4. **Explain the expiry in Settings** and show the last push date.
5. **Retire sync codes** once accounts exist (§ auth-architecture), after offering migration.

### F5 — No CSP or security headers (Medium)
**OWASP:** A05.

**Evidence:**
- No `vercel.json` headers.
- The site serves without a Content-Security-Policy, `Referrer-Policy`, `Permissions-Policy` or `frame-ancestors`.
- CSP is the main backstop if an XSS slips through (F1 shows the stakes: journals sit in `localStorage`).

**Recommendation:** add a `vercel.json` `headers` block. This is a deployment configuration change, so it needs approval. A starting point (inline `style=""` attributes are used throughout, hence `'unsafe-inline'` for styles only):

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: microphone=(self), camera=(), geolocation=()
X-Content-Type-Options: nosniff
```

Roll it out as `Content-Security-Policy-Report-Only` first on a preview deployment.

### F6 — Storage-full errors are unhandled (Medium reliability)
**Evidence:**
- With `localStorage` filled to quota, tapping a habit's checkbox threw `QuotaExceededError` as an uncaught page error.
- The completion wasn't saved and the user saw nothing (`reliability-e2e`).
- `db.js write()` doesn't catch errors.

**Recommendation:** catch the error in `write()`, keep the in-memory change, and show a clear message: "Storage is full: export your data or remove old journal entries". Then consider IndexedDB for journals.

### F7 — No privacy policy (Medium privacy)
Journal text leaves the device in three cases:
- **AI planning:** sent to Anthropic through `/api/plan`.
- **Sync codes:** sent to Upstash.
- **Voice dictation:** Chrome/Edge send audio to Google/Microsoft; Safari uses Apple.

The Settings note now says this. A short privacy page should still exist before the beta widens, and it is required for the App Store.

**Recommendation:** add a privacy page linked from Settings and onboarding covering:
- what's stored on the device
- what goes to Anthropic, Upstash and the dictation vendors
- retention
- how to delete data

### F8 — Plaintext journals in `localStorage` (Medium, accepted for beta)
- Anyone using the same browser profile, and any browser extension with page access, can read journals.
- This comes with the local-first design.

**Mitigations:**
- Done: escaping and import validation (F1/F2).
- Recommended: CSP (F5).
- Later: an optional app passcode, and clearing local data on sign-out once accounts exist.

### F11 — `/api/sync` leaks error details (Low)
`res.status(500).json({ detail: String(err) })` can expose Redis error text.

**Recommendation:** return a generic message and log the details, as `/api/plan` now does.

### F12 — Dev-dependency advisories (Low)
`npm audit` (dev tooling only):
- **esbuild ≤0.24.2 (moderate):** any website can send requests to the dev server.
- **source-map-js (high, denial of service in build tooling).**

Production isn't affected (`--omit=dev`: 0). Risk applies when running `npm run dev` on an untrusted network.

**Recommendation:** run `npm audit fix` for source-map-js, and plan a Vite major upgrade for esbuild. Both are dependency changes, so they need approval.

### F13 — Google Fonts (Low privacy)
Each visit requests fonts from Google, which discloses the visitor's IP to Google.

**Recommendation:** self-host the three font families (this also simplifies the CSP).

### F14 — Framing (Low)
**Recommendation:** `frame-ancestors 'none'` (F5).

### F15 — Multiple tabs (Low)
- **Test:** two tabs each completed a different habit. Both writes were kept, because every change re-reads storage first.
- **Gap:** the other tab keeps showing stale state until it re-renders.

**Recommendation:** listen for the `storage` event and re-render.

### F16 — Theme flash (Low)
**Recommendation:** a tiny inline theme bootstrap in `index.html`. This needs a CSP hash if F5 lands.

### F17 — Distributed abuse of `/api/plan` (Low residual)
- Spreading requests across many IPs gets around the per-client limits. The global cap still bounds total daily calls.
- **Recommendation:** set a monthly spend limit in the Anthropic Console (no code needed) and watch the `unmet:usage:plan:*` counters.

## Areas reviewed with no new findings
- **Input validation on the client:** event and habit forms validate times, days and required fields. Imports are now schema-validated.
- **Calendar and habit integrity:**
  - occurrences respect weekday, date range and excluded dates
  - stacked habits resolve to at most one occurrence per day
  - a broken link shows a relink warning instead of failing
  - editing a habit keeps its history
  - all covered by unit tests in four time zones
- **Authentication:** there is none yet, by design. Planned architecture: `docs/auth-architecture.md`.
- **Mobile and desktop:**
  - layouts checked at 390px and 1440px with no horizontal overflow
  - every screen passes the automated text-size, contrast, tap-target and labelling audit, in dark, light and Arabic
  - **Not tested:** Safari/WebKit (only Chromium is available in this environment), and real devices

## How to re-run
- `npm test`: unit suites under four time zones, plus the mocked API tests.
- The Playwright scripts used for this audit live outside the repo, because the project has no Playwright dependency. Adding `@playwright/test` as a dev dependency would let them be committed; that needs approval.
