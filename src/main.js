import './styles/base.css';
import './theme.js';
import { t } from './i18n.js';
import { getTheme } from './theme.js';
import { isOnboarded } from './db.js';
import { icon } from './icons.js';
import { registerRoute, setNotFound, onRouteChange, startRouter, navigate } from './router.js';
import { renderOnboarding } from './pages/onboarding.js';
import { renderHome } from './pages/home.js';
import { renderCalendar } from './pages/calendar.js';
import { renderJournalHub } from './pages/journalHub.js';
import { renderMorning } from './pages/journalMorning.js';
import { renderEvening } from './pages/journalEvening.js';
import { renderFreeform } from './pages/journalFreeform.js';
import { renderCheckin } from './pages/checkin.js';
import { renderTasks } from './pages/tasks.js';
import { renderInsight } from './pages/insight.js';
import { renderSettings } from './pages/settings.js';

const NAV_ITEMS = [
  { path: '/', icon: 'home', label: 'navHome' },
  { path: '/calendar', icon: 'calendar', label: 'navCalendar' },
  { path: '/journal', icon: 'journal', label: 'navJournal' },
  { path: '/tasks', icon: 'tasks', label: 'navTasks' },
  { path: '/checkin', icon: 'checkin', label: 'navCheckin' },
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
            <button id="settingsBtn" class="icon-circle sm muted" style="cursor:pointer;border:none;">${icon.settings}</button>
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

  renderBottomNav();

  registerRoute('/', renderHome);
  registerRoute('/calendar', renderCalendar);
  registerRoute('/journal', renderJournalHub);
  registerRoute('/journal/morning', renderMorning);
  registerRoute('/journal/evening', renderEvening);
  registerRoute('/journal/freeform', renderFreeform);
  registerRoute('/checkin', renderCheckin);
  registerRoute('/tasks', renderTasks);
  registerRoute('/insight', renderInsight);
  registerRoute('/settings', renderSettings);
  setNotFound(renderHome);

  onRouteChange((path) => {
    updateActiveNav(path);
  });

  startRouter();
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
  if (!isOnboarded()) {
    renderOnboarding(() => {
      renderShell();
    });
  } else {
    renderShell();
  }
}

boot();
