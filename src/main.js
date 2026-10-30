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
import { showStorageWarning, storageWorks } from './lib/storageWarning.js';

const NAV_ITEMS = [
  { path: '/', icon: 'home', label: 'navHome' },
  { path: '/calendar', icon: 'calendar', label: 'navCalendar' },
  { path: '/journal', icon: 'journal', label: 'navJournal' },
  { path: '/tasks', icon: 'tasks', label: 'navTasks' },
];

function brandMarkSvg() {
  return `<svg class="brand-mark" viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="rgTop" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#7FA6D6"/><stop offset="50%" stop-color="#3E699E"/><stop offset="100%" stop-color="#1F3A5C"/>
    </linearGradient></defs>
    <polygon points="400,70 660,220 660,580 400,730 140,580 140,220" fill="none" stroke="#9C9CA3" stroke-width="10" opacity="0.5"/>
    <path d="M 200 260 Q 400 780 600 260" fill="none" stroke="url(#rgTop)" stroke-width="60" stroke-linecap="round"/>
  </svg>`;
}

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
  setNotFound(renderHome);

  onRouteChange((path) => {
    updateActiveNav(path);
    endTour();
    stopActiveDictation();
    dismissUndoToast();
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
    if (e.key === 'unmet_lang' || e.key === 'unmet_backup' || e.key === 'unmet_probe') return;
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

function boot() {
  document.documentElement.setAttribute('data-theme', getTheme());
  watchStorageFailures(); // first, so even onboarding saves are covered
  watchForNewDay();
  watchOtherTabs();
  if (!isOnboarded()) {
    renderOnboarding(() => {
      renderShell();
    });
  } else {
    renderShell();
  }
}

boot();
