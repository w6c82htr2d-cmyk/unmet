// Sign-in / create-account screen: welcome → email → 6-digit code.
// Used full-screen for new visitors (before onboarding) and inside the app from Settings → Account.
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { brandMarkSvg } from '../lib/brand.js';
import { topControls, wireTopControls } from './onboarding.js';
import {
  sendCode, verifyCode, normalizeEmail, normalizeCode, isValidEmail,
  RESEND_COOLDOWN_SECONDS, MAX_CODE_ATTEMPTS,
} from '../lib/auth.js';

// Survives re-renders (language/theme toggles) but not page reloads, on purpose.
let state = freshState();
let tickTimer = null;

function freshState(mode = 'welcome') {
  return { step: mode === 'welcome' ? 'welcome' : 'email', mode, email: '', error: '', notice: '', busy: false, cooldownUntil: 0, attempts: 0 };
}

// opts: { container, standalone, start: 'welcome' | 'signup' | 'signin', onSignedIn(user), onGuest(), onCancel() }
export function renderAuth(opts) {
  state = freshState(opts.start || 'welcome');
  draw(opts);
}

export function stopAuthTimers() {
  clearInterval(tickTimer);
  tickTimer = null;
}

function secondsLeft() {
  return Math.max(0, Math.ceil((state.cooldownUntil - Date.now()) / 1000));
}

function errorText(kind) {
  return t({
    email_invalid: 'authErrEmail',
    code_invalid: 'authErrCode',
    code_format: 'authErrCodeFormat',
    too_many_attempts: 'authErrTooManyAttempts',
    rate_limited: 'authErrRateLimited',
    network: 'authErrNetwork',
    signup_disabled: 'authErrUnavailable',
    unavailable: 'authErrUnavailable',
  }[kind] || 'authErrUnknown');
}

function draw(opts) {
  const { container, standalone } = opts;
  const rerender = () => draw(opts);
  stopAuthTimers();

  const head = `
    <div class="auth-brand">${brandMarkSvg()}<span class="brand-name">UNMET</span></div>
  `;
  const error = state.error ? `<div class="auth-error" role="alert">${escapeHtml(state.error)}</div>` : '';
  const notice = state.notice ? `<div class="auth-notice" role="status">${escapeHtml(state.notice)}</div>` : '';
  let body = '';

  if (state.step === 'welcome') {
    body = `
      <div class="auth-hero">
        ${head}
        <h1 class="auth-title font-head">${t('authHeading')}</h1>
        <p class="auth-sub">${t('authSubheading')}</p>
      </div>
      <div class="auth-actions">
        <button class="btn primary" id="authCreate">${t('authCreateAccount')}</button>
        <button class="btn secondary" id="authSignIn">${t('authSignIn')}</button>
        ${opts.onGuest ? `<button class="btn secondary" id="authGuest">${t('authContinueGuest')}</button>
        <p class="auth-fine">${t('authGuestNote')}</p>` : ''}
      </div>
    `;
  } else if (state.step === 'email') {
    body = `
      <div class="auth-hero">
        ${head}
        <h1 class="auth-title font-head">${t(state.mode === 'signin' ? 'authWelcomeBack' : 'authCreateTitle')}</h1>
        <p class="auth-sub">${t('authEmailIntro')}</p>
      </div>
      <form class="auth-form" id="authEmailForm" novalidate>
        <label class="label-sm" for="authEmail">${t('authEmailLabel')}</label>
        <input class="field" id="authEmail" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false"
          dir="ltr" value="${escapeAttr(state.email)}" required ${state.busy ? 'disabled' : ''} />
        ${error}
        <button class="btn primary" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? t('authSending') : t('authContinueEmail')}</button>
        <p class="auth-fine">${t('authEmailFine')}</p>
      </form>
      <button class="btn ghost" id="authBack">${icon.back} ${t('back')}</button>
    `;
  } else if (state.step === 'code') {
    const wait = secondsLeft();
    body = `
      <div class="auth-hero">
        ${head}
        <h1 class="auth-title font-head">${t('authCodeTitle')}</h1>
        <p class="auth-sub">${t('authCodeIntro', { email: `<bdi dir="ltr">${escapeHtml(state.email)}</bdi>` })}</p>
      </div>
      <form class="auth-form" id="authCodeForm" novalidate>
        <label class="label-sm" for="authCode">${t('authCodeLabel')}</label>
        <input class="field auth-code" id="authCode" type="text" inputmode="numeric" autocomplete="one-time-code"
          pattern="[0-9]*" maxlength="7" dir="ltr" required ${state.busy ? 'disabled' : ''} />
        ${notice}
        ${error}
        <button class="btn primary" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? t('authVerifying') : t('authVerify')}</button>
      </form>
      <div class="auth-secondary">
        <button class="btn ghost sm" id="authResend" ${wait || state.busy ? 'disabled' : ''} aria-live="polite">
          ${wait ? t('authResendIn', { s: wait }) : t('authResend')}
        </button>
        <button class="btn ghost sm" id="authChangeEmail" ${state.busy ? 'disabled' : ''}>${t('authChangeEmail')}</button>
      </div>
      <p class="auth-fine">${t('authCodeFine')}</p>
    `;
  }

  container.innerHTML = `
    <div class="${standalone ? 'onboard-wrap auth-wrap' : 'page auth-wrap'}">
      ${standalone ? topControls() : `<button class="back-row" id="authCancel">${icon.back} ${t('back')}</button>`}
      ${standalone ? '<div class="auth-spacer"></div>' : ''}
      ${body}
      ${standalone ? '<div class="auth-spacer"></div>' : ''}
    </div>
  `;
  if (standalone) wireTopControls(container, rerender);
  container.querySelector('#authCancel')?.addEventListener('click', () => opts.onCancel?.());

  if (state.step === 'welcome') {
    container.querySelector('#authCreate').addEventListener('click', () => { state = freshState('signup'); rerender(); });
    container.querySelector('#authSignIn').addEventListener('click', () => { state = freshState('signin'); rerender(); });
    container.querySelector('#authGuest')?.addEventListener('click', () => opts.onGuest?.());
    return;
  }

  if (state.step === 'email') {
    const input = container.querySelector('#authEmail');
    if (!state.busy) input.focus();
    container.querySelector('#authBack').addEventListener('click', () => {
      if (standalone) { state = freshState('welcome'); rerender(); } else opts.onCancel?.();
    });
    container.querySelector('#authEmailForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = normalizeEmail(input.value);
      state.email = email;
      if (!isValidEmail(email)) {
        state.error = errorText('email_invalid');
        rerender();
        return;
      }
      // Already sent a code to this address within the last minute: reuse it rather than re-sending.
      if (secondsLeft() && state.lastSentTo === email) {
        state.step = 'code';
        state.error = '';
        rerender();
        return;
      }
      await send(rerender, 'code');
    });
    return;
  }

  // code step
  const input = container.querySelector('#authCode');
  if (!state.busy) input.focus();
  input.addEventListener('input', () => {
    const digits = normalizeCode(input.value);
    if (digits.length === 6 && !state.busy) container.querySelector('#authCodeForm').requestSubmit();
  });
  container.querySelector('#authCodeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = normalizeCode(input.value);
    if (code.length !== 6) {
      state.error = errorText('code_format');
      state.notice = '';
      rerender();
      return;
    }
    if (state.attempts >= MAX_CODE_ATTEMPTS) {
      state.error = errorText('too_many_attempts');
      rerender();
      return;
    }
    state.busy = true;
    state.error = '';
    state.notice = '';
    rerender();
    try {
      const user = await verifyCode(state.email, code);
      state = freshState('welcome');
      opts.onSignedIn?.(user);
    } catch (err) {
      state.busy = false;
      if (err.kind === 'code_invalid') state.attempts += 1;
      state.error = state.attempts >= MAX_CODE_ATTEMPTS ? errorText('too_many_attempts') : errorText(err.kind);
      rerender();
    }
  });
  container.querySelector('#authResend').addEventListener('click', () => send(rerender, 'code'));
  container.querySelector('#authChangeEmail').addEventListener('click', () => {
    state.step = 'email';
    state.error = '';
    state.notice = '';
    rerender();
  });
  if (secondsLeft()) {
    tickTimer = setInterval(() => {
      const btn = container.querySelector('#authResend');
      if (!btn || !document.body.contains(btn)) return stopAuthTimers();
      const s = secondsLeft();
      btn.textContent = s ? t('authResendIn', { s }) : t('authResend');
      btn.disabled = s > 0 || state.busy;
      if (!s) stopAuthTimers();
    }, 1000);
  }
}

async function send(rerender, nextStep) {
  state.busy = true;
  state.error = '';
  state.notice = '';
  rerender();
  try {
    await sendCode(state.email);
    state.step = nextStep;
    state.attempts = 0;
    state.lastSentTo = state.email;
    state.notice = t('authCodeSent');
    state.cooldownUntil = Date.now() + RESEND_COOLDOWN_SECONDS * 1000;
  } catch (err) {
    state.error = errorText(err.kind);
    // The server also limits sending; don't let the button hammer it.
    if (err.kind === 'rate_limited') state.cooldownUntil = Date.now() + RESEND_COOLDOWN_SECONDS * 1000;
  }
  state.busy = false;
  rerender();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
