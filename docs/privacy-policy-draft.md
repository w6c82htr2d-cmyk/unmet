# UNMET Privacy Policy: DRAFT FOR OWNER REVIEW

> **Not published.** This draft describes how the current beta code handles data (as of
> 2026-10-30). Items in **[brackets]** need the owner's input or confirmation. It is not legal advice
> and makes no legal guarantees; have it reviewed before publishing, especially if users are in the
> EU/UK, California or other places with specific privacy laws, or if minors may use UNMET.

**Effective date:** [date]
**Who we are:** UNMET ("we") is operated by [legal name / individual], [country]. Contact: [email address].

## 1. The short version

- UNMET works **without an account**. Your habits, calendar, journal entries and goals are stored
  **in your own browser**, on your device.
- Your data leaves your device only when **you** use one of these features:
  - **AI planning** ("Turn into a plan"): the entry is sent to Anthropic to generate the plan.
  - **AI Task Splitter** ("Break it down"): the task you type, plus any optional challenges or note you add, is sent to Anthropic to suggest steps.
  - **Sync codes**: a copy of your data is stored on our server provider (Upstash) under your code.
  - **Voice dictation**: your browser's speech service (for example Google in Chrome) processes the audio.
- UNMET currently uses no analytics, no advertising trackers and no cookies, and we don't sell
  personal data.

## 2. Data stored on your device

UNMET saves the following in your browser's local storage:
- your first name
- your chosen goals
- habits and their completion history
- calendar routines and events
- morning intentions, evening reflections and free-form journal entries (including any AI-generated plans)
- Task Splitter goals and steps
- display preferences (theme, language, calendar view)
- whether you've seen the intro tour

Two extra copies may also be stored:
- **Backup copy:** UNMET keeps one local backup of your data. It is made before an import, a sync-code load or a restore, so you can undo the change.
- **Sync code:** if you use a sync code, the code and the time of your last sync.

**Who can see it:**
- This data is not sent to us.
- Anyone who uses the same browser profile on your device, and browser extensions with access to web pages, may be able to read it.
- If you share a device, consider using a separate browser profile.

**How to delete it:**
- Settings → "Reset all data" removes everything UNMET stores in this browser, including the backup copy and the remembered sync code. Your theme and language preferences are kept.
- Clearing your browser's site data for UNMET also removes everything.

**How to export it:** Settings → "Export my data" downloads a copy as a file.

## 3. AI planning and the AI Task Splitter

When you choose "Turn into a plan" in the free-form journal:

- **What we send:** the text of that entry (up to its first 4,000 characters) goes from your browser to our server function and then to **Anthropic** (the provider of the Claude AI models), which returns a suggested plan.
- **What we keep:**
  - Our server does **not** store the text.
  - Our logs record only technical details, such as whether the request succeeded, how long it took and how much AI processing it used. They never include your text.
  - The resulting plan is saved on your device with the entry.
- **How Anthropic handles it:** Anthropic processes the text under its commercial terms and privacy policy: [link]. [Owner to confirm and summarise Anthropic's current retention and model-training terms for API data.]
- **If you don't want this:** don't use AI planning. "Save entry" keeps a free-form entry on your device only, and the rest of the journal works entirely on your device.

**AI Task Splitter.** When you choose "Break it down" in the Task Splitter:

- **What we send:** the task text (up to 300 characters), the "what gets in the way" options you selected (if any), your optional note (up to 300 characters) and the app language. These go from your browser to our server function and then to **Anthropic**, which returns suggested steps.
- **What we keep:** the same as AI planning above. Our server does not store the text, and our logs never include it. The steps are saved on your device. Your selected options and note are also remembered **on your device** for next time.
- **If it isn't available:** the app shows general starter steps created on your device, and nothing is sent.

**Abuse prevention:** to limit misuse, our server counts AI requests per visitor, using a one-way
scrambled ("hashed") form of your IP address combined with a secret value. We do not store your IP
address itself. These counters expire within about a day. We also keep daily totals (number of
requests and amount of AI processing, with no personal information) for up to 90 days to monitor
costs and reliability.

## 4. Sync codes

If you create or enter a sync code in Settings:

- **What's stored:** a copy of your UNMET data, **including journal entries**, is stored with our database provider **Upstash** ([region: owner to confirm]) under that code. A revision number and an expiry date are stored alongside it.
- **Who can access it:**
  - **Anyone who has the code** can view, replace or delete that data. Treat it like a password.
  - The code is long and randomly generated (12 characters), and our server limits how many attempts each visitor can make, to make guessing impractical.
  - The stored copy is **not end-to-end encrypted**, so it's readable by anyone with the code and, technically, by people with administrative access to our database account. [Update this if encrypted sync is approved and released.]
- **How long it's kept:** synced data is deleted automatically **180 days after it was last uploaded or loaded**.
- **Deleting it sooner:** use Settings → "Delete the synced copy". This deletes the server copy immediately. The data on your device stays.
- **Abuse prevention:** sync requests are rate limited in the same hashed-IP way as AI requests (§3).

## 4b. Reminders and weekly recap

- **Reminders** are optional and off by default. They use your browser's own notifications, are created on your device and involve no server. Your choice is stored on your device.
- **Your Week, Unmet** and **Insights** are calculated on your device from your own check-ins. A shared recap image is created on your device and contains only the numbers shown (habit names only if you turn that on). Nothing is uploaded by UNMET when you share it.

## 5. Voice dictation

The microphone button in the Task Splitter and free-form journal uses your **browser's own speech
recognition**.

- UNMET never receives or stores audio. Only the resulting text appears in the text box, and it stays on your device unless you then use AI planning, the AI Task Splitter or sync.
- Depending on your browser, the audio may be sent to the browser maker's speech service:
  - Chrome: Google
  - Edge: Microsoft
  - Safari: Apple, which may process it on the device
- Each browser maker handles that audio under its own privacy policy.
- Firefox doesn't support this feature.
- Your browser asks for microphone permission. You can deny it or revoke it at any time in its settings.

## 6. Hosting, fonts and technical data

- **Hosting:** UNMET is hosted on **Vercel**. Like any web host, Vercel processes technical request data (such as IP address, browser type and the page requested) to deliver the site and keep it secure, and may keep logs for a limited period. [Owner to confirm the Vercel plan/log retention and link Vercel's privacy policy.]
- **Fonts:** UNMET loads fonts from **Google Fonts**, so your browser contacts Google's servers. Google receives your IP address and browser details: [link to Google's privacy policy]. [If fonts are later self-hosted, remove this paragraph.]

## 7. Security

We use measures such as:
- encrypted connections (HTTPS)
- strict validation of imported and synced data
- rate limits on our server functions
- browser security headers, including a Content-Security-Policy

No method of storage or transmission is completely secure, and we can't guarantee absolute security.

## 8. Your choices and rights

- **Access and portability:** export your data at any time (Settings → Export).
- **Deletion:**
  - Reset all data (device).
  - Delete the synced copy (server).
  - AI planning and Task Splitter text isn't stored by us; Anthropic's handling is described in §3.
- [Owner/legal: add any rights that apply to your users' location, e.g. GDPR/UK GDPR rights and the legal bases for processing, or CCPA/CPRA notices, and how to contact you to exercise them.]

## 9. Children

[Owner to decide: the minimum age for using UNMET, and what happens if a younger child uses it. UNMET
is aimed at university students.]

## 10. Accounts (in testing) and subscriptions (not available)

[Include this section once accounts are switched on for users. Today they're only enabled in test builds.]

- **Creating an account is optional.** Guests can use every feature.
- **To sign in** you give your email address, and we email you a one-time 6-digit code. Our sign-in provider **Supabase** ([region: owner to confirm]) stores your email address and account records such as creation and last sign-in times, to run your account.
- **Staying signed in:** your browser keeps a sign-in session (access and refresh tokens) so you stay signed in. Signing out removes it from that browser; "Sign out everywhere" ends your sessions on all devices.
- **Your data:** at this stage your habits, calendar and journals stay on your device even when you're signed in. [Update when automatic sync launches, including that journal syncing is optional and off by default.]
- **Deleting your account:** [describe once account deletion is available.]
- **Subscriptions:** UNMET doesn't offer paid subscriptions. This policy will be updated before that changes.

## 11. Changes

We'll update this page when how UNMET handles data changes, and change the effective date above.
[Owner to decide how significant changes will be announced, e.g. a notice in the app.]

## 12. Contact

[Email address] · [Postal address if required]

---

### Owner review checklist (remove before publishing)
- [ ] Legal name, country and contact email
- [ ] Upstash and Supabase regions; Vercel plan and log retention
- [ ] Anthropic API data retention and training terms (current wording and link)
- [ ] Minimum age
- [ ] Applicable laws and rights section (legal review)
- [ ] Decide where the page lives (e.g. `/privacy`) and link it from Settings and onboarding
