# UNMET — Business Model & Subscription Plan (proposal)

> **Status: proposal only. UNMET is in beta.** Nothing in this document is active. There is no trial
> countdown, paywall, payment, or subscription in the app, and every feature stays free for beta
> testers. Building any part of billing requires explicit approval from the owner first.
>
> **Open question:** the Final Product Brief mentions a *7-day UNMET+ trial*. This document follows the
> later decision of a *10-day full-access trial with no free tier*. Waiting for the owner to confirm which applies.

## 1. The model in one line

**10 days of full access to every UNMET feature, no payment details needed, then a paid
subscription (monthly or annual) to keep using it.** No permanent free tier, no automatic charge
when the trial ends, and user data is never deleted or held hostage.

| Rule | How it is met |
|---|---|
| No payment details to start | Trial starts when the account is created. No card, no Apple purchase sheet. |
| Every feature for all 10 days | Trial users get the same entitlement as subscribers: AI, insights, Your Week, Unmet, everything. |
| No permanent free tier | After day 10 the app goes into a *Paused* state (section 5). Tracking, journaling, AI and calendar editing stop until the user subscribes. |
| No automatic charge at trial end | Impossible by design: no payment method is collected during the trial, and on iOS no Apple introductory offer is used. |
| Users must choose to subscribe | Subscribing is a separate, explicit step: Stripe Checkout on the web, the StoreKit purchase sheet on iOS. |
| Monthly and annual plans | Two plans: **UNMET Monthly** and **UNMET Annual**. |
| Native In-App Purchase on iOS | StoreKit 2 auto-renewable subscriptions. |
| Apple Pay on the web | Stripe Checkout shows Apple Pay on eligible devices and browsers (and Google Pay, plus cards). |
| Data kept after the trial | Nothing is deleted. Habits, history, journals, events, plans and past weekly recaps all stay. |
| Always available, even without a subscription | Account settings, data export, subscription management, restore purchases, account deletion, privacy policy, support, sign out, language and theme. |
| At least one Your Week, Unmet in the trial | The first Your Week, Unmet recap, "Your first week", is generated on trial day 7 (section 4). |
| Safeguards that don't get in the way | Fair-use limits set well above normal use, and enforced on the server (section 7). |

Naming: with no free tier there is no "UNMET+". The product is just **UNMET**, sold as
**Monthly** or **Annual**.

## 2. Plans and pricing (to be tested)

| | Monthly | Annual |
|---|---|---|
| Starting hypothesis A | $4.99 / month | $34.99 / year (about 42% off) |
| Starting hypothesis B (student-friendly) | $2.99 / month | $19.99 / year |
| Renewal | Renews monthly until cancelled | Renews yearly until cancelled, with a reminder email before each renewal |
| Cancel | Any time. Access continues to the end of the paid period. | Same |

- Prices exclude sales tax and VAT. On the App Store, prices include VAT in many regions, which lowers net revenue there.
- Both plans unlock exactly the same features. Annual is just cheaper per month.
- The paywall and checkout always show: the price, the billing period, that it renews automatically, how to cancel, and links to the Terms and the Privacy Policy. No pre-checked boxes, no checkout that starts on its own.
- The final Terms (auto-renewal law, EU right of withdrawal) need a legal review before launch.

## 3. Payments

| | Web (getunmet.com) | Future iOS app |
|---|---|---|
| Checkout | Stripe Checkout (hosted) | StoreKit 2 purchase sheet |
| Payment methods | Apple Pay (eligible Safari/iOS/macOS devices), Google Pay, cards | The user's Apple ID payment method (Apple's IAP) |
| Products | Two Stripe Prices: monthly, annual | One subscription group with two products, `unmet_monthly` and `unmet_annual`, and **no introductory offer** |
| Manage / cancel | Stripe Customer Portal, linked from Settings | Apple's subscription settings, linked from Settings |
| Restore | Not needed. Access follows the account. | "Restore purchases" button (Apple requires it) |
| Fees (approximate) | About 2.9% + $0.30 per charge | 15% (Apple Small Business Program; 30% above $1M per year) |

- **Apple Pay on the web:** Stripe takes care of the Apple Pay merchant setup. You just verify the getunmet.com domain in the Stripe dashboard, and Stripe hosts the verification file.
- **Apple Pay inside the iOS app:** it can't be used for digital subscriptions there. In-app purchases have to go through IAP.
- **Subscribing on one platform, using another:** an account that subscribed on the web also has access in the iOS app, and vice versa. Apple allows this for services that run on several platforms.
- **Linking to web checkout from iOS:** Apple's rules here changed in the US in 2025 and differ by country. Check them again before the iOS build.

## 4. Onboarding and the 10-day trial (future flow)

Account creation becomes the first step, because the trial and any later subscription have to
belong to an account. The beta onboarding steps (name, goals, routine → habit) stay as they are and
come right after it.

1. **Welcome:** what UNMET does, in one screen.
2. **Create your account:** email magic link or Sign in with Apple.
   Copy: *"Start your 10-day free trial. No payment details needed, and nothing is charged when it ends."*
3. **Existing onboarding:** name → goals → "Start with your existing routine" → first habit.
4. **Trial status:** a quiet "Day 3 of 10" line in Settings. No countdown pressure before day 8.

### Trial timeline

| Day | What the user sees |
|---|---|
| 1 | Welcome. First routine and first stacked habit (existing guidance). |
| 2 | One in-context hint: try "Turn into a plan" in the free-form journal. |
| 3–5 | Hints for Task Splitter, insights and Day/Week calendar, each shown once and only if unused. |
| **7** | **"Your first week" Your Week, Unmet** is generated and highlighted on Home. |
| 8 | "3 days left": an in-app card (plus email if allowed) with both plans, prices, renewal terms and cancellation terms. |
| 9 | "Your trial ends tomorrow" reminder. |
| 10 | The trial runs **through the end of day 10 in the user's own time zone**. After that, the Paused state starts. |
| After | One follow-up email around day 13. No ongoing nagging. |

### Making sure there's a Your Week, Unmet during the trial

- **The first Your Week, Unmet recap is tied to the trial start, not the calendar.** It is generated at the end of the user's day 7 and covers days 1–7. Every 10-day trial gets one, three days before the trial ends, which makes it a natural point to decide.
- **Thin weeks still get a recap.** With little data (for example fewer than 3 active days), it still appears, with an encouraging summary instead of empty charts.
- **It gets surfaced if missed.** If it hasn't been opened by day 8, it is shown again on Home and in the day-8 reminder.
- **Later weekly recaps** come out weekly on the user's chosen day (default Sunday).

## 5. When the trial ends: the Paused state (data kept)

**Still available without a subscription:**
- Account settings, sign out, language and theme
- Data export (JSON, the existing export) and import
- Subscription plans, subscribe, restore purchases, manage subscription
- Account deletion (section 6)
- Privacy policy, Terms, help and support contact
- **Recommended:** read-only viewing of the user's own habits, history, journals and past weekly recaps. Seeing your own data isn't a free tier, and it builds trust (owner decision).

**Paused until the user subscribes:**
- Checking off habits, new journal entries, calendar editing, Task Splitter, AI features, new insights, new weekly recaps

**Data rules:**
- Nothing is deleted, locked away or downgraded. The data stays on the device and in any sync storage.
- Completion history is untouched. Days spent in the Paused state are shown as **"paused" rather than "missed"** (display only), so streak charts don't punish the gap.
- Subscribing restores everything immediately, exactly as it was.
- A lapsed subscription (cancelled, or payment failed after the billing grace period) goes back to Paused with the same rules.

## 6. Account deletion and cancellation

- **Deletion is available in Settings to everyone**, with or without a subscription. Apple requires in-app deletion for apps that create accounts.
- **Deleting the account removes it from the server:** identity, entitlement records and AI usage logs. A separate choice also erases the data on the current device. The user is offered an export first.
- **Web subscriptions are cancelled automatically** when the account is deleted, and the screen says so.
- **Apple subscriptions can't be cancelled by UNMET.** The deletion screen says this clearly and links to Apple's subscription settings.

## 7. Architecture

```
Browser app / future iOS app
   │  sign in (magic link · Sign in with Apple)
   ▼
UNMET server (Vercel functions)
   ├─ users           id, created_at, trial_started_at, trial_ends_at, trial_used
   ├─ subscriptions   user_id, source (stripe|app_store), product, status,
   │                  current_period_end, auto_renew, store ids
   ├─ ai_usage        per-user daily/monthly counters (Upstash Redis, already in use)
   └─ entitlement     access = full | paused   (computed on the server only)
   ▲                         ▲
   │ Stripe webhooks         │ App Store Server Notifications V2 + App Store Server API
   │ (signature-checked)     │ (signed JWS, Apple certificate chain checked)
```

**Entitlement states:**

| State | Meaning | Access |
|---|---|---|
| `beta` | Monetization is switched off (now) | Full |
| `trialing` | Inside the 10-day trial | Full |
| `active` | Paid subscription | Full |
| `grace` | Renewal payment failing; store is retrying | Full |
| `paused` | Trial over or subscription ended | Section 5 only |

**How access is enforced:**
- The server computes the state. The app receives a **short-lived signed entitlement token** (about 15 minutes, extended offline for up to 3 days so a flaky connection never blocks normal use).
- **Every premium server request re-checks access on the server:** AI, Your Week, Unmet generation, deeper insights and sync. Editing the app's code can't unlock server features.
- **Honest limit:** UNMET is local-first, so habits and journals live in the browser. Gating features that run entirely on the device is a deterrent, not real security. A determined person could patch the web app to keep using local tracking. This is accepted on purpose to keep journals private. The valuable, costly parts (AI, weekly recaps, insights, sync) run on the server, so they are properly protected.
- **iOS purchases:** each StoreKit purchase carries an `appAccountToken` equal to the UNMET user id. The app sends Apple's signed transaction to the server, which verifies it before granting access. Server notifications keep renewals, refunds and cancellations up to date.

**The beta switch:** a server setting `MONETIZATION_MODE=beta` gives everyone `beta` (full access) and
hides all trial and pricing screens. Changing it to `live` is a launch decision for the owner only.

**Services needing approval before any build:**
- An account/login provider (proposed: Supabase free tier)
- Stripe (per-transaction fees only)
- Optionally RevenueCat, to merge Apple and Stripe subscriptions in one place (free up to a revenue threshold, then a percentage)

### The iOS trial: a gray area to confirm

- **Apple's built-in free trial (introductory offer) is ruled out.** It turns into a paid subscription automatically, which breaks the "no automatic charge" rule.
- **Proposed instead: an account-based trial run by our server.** No App Store transaction happens until the user picks a plan.
- **Confirm with App Review before the iOS build.** Apple documents a "$0 trial unlock" purchase only for apps *without* subscriptions, so the server-run trial needs checking first.

## 8. AI costs and safeguards

**Cost estimates** (current AI model in `api/plan.js`, priced at $1 per million input tokens and $5 per million output tokens):

| Feature | Per use | Typical subscriber, per month |
|---|---|---|
| Journal → plan | about $0.0025 (worst case $0.0064) | about $0.08 |
| AI task splitting | about $0.003 | about $0.05 |
| Your Week, Unmet reflection | about $0.01 | about $0.04 |
| Insight summaries (cached daily) | about $0.003 | about $0.10 |
| **Total** | | **about $0.25–$0.50** (worst case at the limits: about $2) |

- **A typical 10-day trial** costs about $0.10–$0.15 in AI (worst case about $0.70).

**Safeguards, set well above normal use:**
- **AI requires a signed-in account with full access.** Trial users and subscribers get identical limits.
- **Fair-use limits:**
  - journal → plan: 20 per day
  - AI task splitting: 20 per day
  - Your Week, Unmet: generated once per week and cached, with 2 regenerations
  - insights: cached daily
  - all AI features together: 300 calls per month
- **Existing request limits stay:** at most 4,000 input characters and 1,024 output tokens per request.
- **Usage logging and an emergency stop:** token usage is logged per user, and AI pauses for everyone if total daily spend passes a set amount.
- **Monthly spend limit in the Anthropic Console:** recommended now, during beta. You set it yourself; no code change needed.
- **Per-IP rate limit on `/api/plan`:** recommended now, because the endpoint is currently open to anyone. Needs owner approval, since it touches the AI endpoint (access control only, not the AI call).

**Stopping repeat trials:**
- One trial per verified email.
- Disposable-email blocklist and Cloudflare Turnstile (free) at sign-up.
- On iOS, DeviceCheck marks "trial used" for a device even after reinstalling.

## 9. Moving beta testers over

- Beta testers keep **everything free until launch**.
- **At launch,** each beta tester gets a **fresh 10-day trial starting on launch day**, not counted from when they first joined. Otherwise everyone would be expired on day one.
- They get at least 14 days' notice in the app before launch, plus a **founding-member discount** (for example 30–40% off the first year).
- Beta data lives in the browser. Creating an account at launch attaches entitlements to it **without moving or touching local data**.

## 10. Testing prices during beta (no paywall)

1. **Does 10 days reach the "aha" moment?**
   - Track the share of beta users active on day 7 and day 10.
   - Track how many reach their first Your Week, Unmet recap and log 3 or more check-in days in their first 10 days.
   - This needs privacy-friendly event counts, either in Upstash or PostHog's free tier (owner choice).
2. **Ask testers.**
   - Short price-sensitivity survey with 20–50 testers.
   - 5–10 interviews.
   - A clearly labelled "Plans coming after beta" preview page, with no checkout.
3. **At launch, compare prices.**
   - New sign-ups only; each person always sees the same price.
   - Track trial-to-paid rate, monthly vs annual mix, renewal in month 2, refunds, and AI cost per subscriber.

## 11. Pitch deck: business model slide

**Subscription with a full-access trial.**
- **10 days of everything, free. No card.** Then UNMET Monthly or UNMET Annual. *(Prices under test: $4.99/month or $34.99/year.)*
- **Two payment paths.** Web through Stripe, with Apple Pay. iOS through the App Store.
- **Trust as a feature.** No automatic charges after the trial, data is never held hostage, and you can export or delete any time.
- **Built-in conversion moment.** Every trial includes a personal Your Week, Unmet on day 7.

**Unit economics** (per subscriber, after platform fees and AI at about $0.40/month; excludes tax, VAT and hosting):

| Plan | Price | Platform fee | AI | Contribution | Margin |
|---|---|---|---|---|---|
| Monthly, web | $4.99 | $0.44 | $0.40 | $4.15 | about 83% |
| Monthly, iOS | $4.99 | $0.75 | $0.40 | $3.84 | about 77% |
| Annual, web | $34.99 | $1.31 | $4.80 | $28.88 | about 83% |
| Annual, iOS | $34.99 | $5.25 | $4.80 | $24.94 | about 71% |

**Illustrative revenue per 1,000 trial starts** (assumptions, not benchmarks; blended $3.95/month per subscriber, half monthly and half annual at hypothesis A prices):

| Trial → paid | Subscribers | Monthly recurring revenue |
|---|---|---|
| 5% | 50 | about $198 |
| 10% | 100 | about $395 |
| 15% | 150 | about $593 |

**Metrics we'll report:** trial starts, share of trials that reach the first Your Week, Unmet recap, trial → paid,
annual mix, month-2 retention, refund rate, AI cost per subscriber.

## 12. Open decisions for the owner

1. In the Paused state, can users view their own data read-only? (Recommended: yes.)
2. Is an account required at the very start of the trial? (Recommended: yes. It's needed to track the trial and keep data safe.)
3. Which price hypothesis to test first: A, B, or both?
4. The founding-member discount for beta testers, and how much notice to give before launch.
5. Still open from before: the account provider, RevenueCat or not, and the `/api/plan` rate limit.
