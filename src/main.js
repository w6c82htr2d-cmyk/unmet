import './styles/base.css';
import './theme.js';
import { t } from './i18n.js';
import { getTheme, applyThemeFromStorage } from './theme.js';
import { isOnboarded, todayStr } from './db.js';
import { icon } from './icons.js';
import { registerRoute, setNotFound, onRouteChange, startRouter, navigate, currentPath, rerenderCurrentRoute } from './router.js';
import { renderOnboarding } from './pages/onboarding.js';
import { renderHome } from './pages/home.js';
import { renderCalendar } from './pages/calendar.js';
import { renderJournalHub } from './pages/journalHub.js';
import { renderMorning } from './pages/journalMorning.js';
import { renderEvening } from './pages/journalEvening.js';
import { renderFreeform } from './pages/journalFreeform.js';
import { renderTasks } from './pages/tasks.js';
import { renderInsight } from './pages/insight.js';
import { renderSettings } from './pages/settings.js';
import { renderHelp } from './pages/help.js';
import { endTour } from './lib/tour.js';
import { stopActiveDictation } from './lib/speechToText.js';
import { dismissUndoToast } from './lib/undoToast.js';
import { brandMarkSvg } from './lib/brand.js';
import { authAvailable, initAuth, onUserChange } from './lib/auth.js';
import { renderAuth, stopAuthTimers } from './pages/auth.js';
import { showStorageWarning, storageWorks } from './lib/storageWarning.js';

const NAV_ITEMS = [
  { path: '/', icon: 'home', label: 'navHome' },
  { path: '/calendar', icon: 'calendar', label: 'navCalendar' },
  { path: '/journal', icon: 'journal', label: 'navJournal' },
  { path: '/tasks', icon: 'tasks', label: 'navTasks' },
];


function renderShell() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="app-shell">
      <div class="topbar">
        <div class="topbar-inner">
          <a href="#/" class="brand">${brandMarkSvg()}<span class="brand-name">${t('appName').toUpperCase()}</span></a>
          <div class="controls">
            <button id="helpBtn" class="icon-circle sm muted" title="${t('openHelp')}" aria-label="${t('openHelp')}" style="cursor:pointer;border:none;">${icon.help}</button>
            <button id="settingsBtn" class="icon-circle sm muted" title="${t('settingsTitle')}" aria-label="${t('settingsTitle')}" style="cursor:pointer;border:none;">${icon.settings}</button>
          </div>
        </div>
      </div>
      <div id="page-root"></div>
      <nav class="bottom-nav">
        <div class="bottom-nav-inner" id="bottomNav"></div>
      </nav>
    </div>
  `;

  document.getElementById('settingsBtn').addEventListener('click', () => navigate('/settings'));
  document.getElementById('helpBtn').addEventListener('click', () => navigate('/help'));

  renderBottomNav();

  registerRoute('/', renderHome);
  registerRoute('/calendar', renderCalendar);
  registerRoute('/journal', renderJournalHub);
  registerRoute('/journal/morning', renderMorning);
  registerRoute('/journal/evening', renderEvening);
  registerRoute('/journal/freeform', renderFreeform);
  registerRoute('/help', renderHelp);
  registerRoute('/tasks', renderTasks);
  registerRoute('/insight', renderInsight);
  registerRoute('/settings', renderSettings);
  registerRoute('/account', renderAccountRoute);
  setNotFound(renderHome);

  onRouteChange((path) => {
    updateActiveNav(path);
    endTour();
    stopActiveDictation();
    dismissUndoToast();
    stopAuthTimers();
  });

  startRouter();
}

// Another tab saved something: refresh this tab's page so it doesn't keep showing stale data.
// Writes were never at risk (every change re-reads storage first); this is about what's on screen.
// The refresh waits while someone is mid-edit here, so typed text is never re-rendered away.
function watchOtherTabs() {
  let pending = false;
  const editing = () => {
    const root = document.getElementById('page-root');
    if (!root || root.querySelector('#eventModalOverlay')) return true;
    const active = document.activeElement;
    if (active && root.contains(active) && active.matches('input, textarea, select, [contenteditable]')) return true;
    return [...root.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea')]
      .some((el) => el.value !== el.defaultValue);
  };
  const refresh = () => {
    if (!pending || !isOnboarded() || editing()) return;
    pending = false;
    rerenderCurrentRoute();
  };
  window.addEventListener('storage', (e) => {
    if (e.key === 'unmet_theme') { applyThemeFromStorage(); return; }
    if (e.key !== null && !e.key.startsWith('unmet_')) return;
    if (['unmet_lang', 'unmet_backup', 'unmet_probe', 'unmet_auth', 'unmet_auth_choice'].includes(e.key)) return;
    pending = true;
    refresh();
  });
  document.addEventListener('focusout', () => setTimeout(refresh, 0));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
}

// A failed save throws StorageError out of whatever action was running (so it never shows as done)
// and fires 'unmet:storage-failed'; here that becomes a visible warning instead of a silent failure.
function watchStorageFailures() {
  window.addEventListener('unmet:storage-failed', () => showStorageWarning('failed'));
  const swallow = (e) => { if ((e.error || e.reason)?.name === 'StorageError') e.preventDefault(); };
  window.addEventListener('error', swallow);
  window.addEventListener('unhandledrejection', swallow);
  if (!storageWorks()) showStorageWarning('unavailable');
}

// When the tab comes back after midnight, refresh the pages whose content is "today" so they
// don't keep showing yesterday. Only read-mostly pages, so no half-typed form is re-rendered away.
function watchForNewDay() {
  let lastDay = todayStr();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const now = todayStr();
    if (now === lastDay) return;
    lastDay = now;
    const [base] = currentPath().split('?');
    if (base === '/' || base === '/journal') rerenderCurrentRoute();
  });
}

function renderBottomNav() {
  const nav = document.getElementById('bottomNav');
  nav.innerHTML = NAV_ITEMS.map((item) => `
    <button class="nav-item" data-path="${item.path}">
      ${icon[item.icon]}
      <span>${t(item.label)}</span>
    </button>
  `).join('');
  nav.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.path));
  });
}

function updateActiveNav(path) {
  const topLevel = '/' + (path.split('/')[1] || '');
  document.querySelectorAll('.nav-item').forEach((btn) => {
    const btnPath = btn.dataset.path === '/' ? '/' : btn.dataset.path;
    btn.classList.toggle('active', btnPath === topLevel || (btnPath === '/journal' && path.startsWith('/journal')));
  });
}

export function rerenderShellChrome() {
  renderShell();
}

// Settings → Account → "Sign in or create account" (inside the app, for people already using it).
function renderAccountRoute(root) {
  if (!authAvailable()) { navigate('/settings'); return; }
  renderAuth({
    container: root,
    standalone: false,
    start: 'welcome',
    onSignedIn: () => navigate('/settings'),
    onCancel: () => navigate('/settings'),
  });
}

const AUTH_CHOICE_KEY = 'unmet_auth_choice'; // the new-visitor welcome was answered (guest or signed in)

function authChoiceMade() {
  try {
    return localStorage.getItem(AUTH_CHOICE_KEY) !== null;
  } catch {
    return true;
  }
}

function rememberAuthChoice(choice) {
  try {
    localStorage.setItem(AUTH_CHOICE_KEY, choice);
  } catch {
    // Not remembered: the welcome may show again next visit, which is harmless.
  }
}

function boot() {
  document.documentElement.setAttribute('data-theme', getTheme());
  watchStorageFailures(); // first, so even onboarding saves are covered
  watchForNewDay();
  watchOtherTabs();
  initAuth();
  onUserChange(() => {
    const [base] = currentPath().split('?');
    if (base === '/settings' && isOnboarded()) rerenderCurrentRoute();
  });
  const startOnboarding = () => renderOnboarding(() => renderShell());
  if (isOnboarded()) {
    renderShell();
  } else if (authAvailable() && !authChoiceMade()) {
    // New visitor: offer an account, never require one.
    renderAuth({
      container: document.getElementById('app'),
      standalone: true,
      start: 'welcome',
      onGuest: () => { rememberAuthChoice('guest'); startOnboarding(); },
      onSignedIn: () => { rememberAuthChoice('account'); startOnboarding(); },
    });
  } else {
    startOnboarding();
  }
}

boot();
