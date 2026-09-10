import { t, getLang, setLang } from '../i18n.js';
import { getTheme, setTheme } from '../theme.js';
import { getProfile, saveProfile, exportAll, importAll, resetAll } from '../db.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';

const GOAL_TRACKS = [
  { id: 'gpa', label: 'goalGPA', icon: 'bookGoal' },
  { id: 'fitness', label: 'goalFitness', icon: 'dumbbell' },
  { id: 'language', label: 'goalLanguage', icon: 'language' },
  { id: 'wellness', label: 'goalWellness', icon: 'wellness' },
];

export function renderSettings(root) {
  const profile = getProfile() || { firstName: '', goalTracks: [] };
  const lang = getLang();
  const theme = getTheme();

  root.innerHTML = `
    <div class="page">
      <button class="back-row" id="backBtn">${icon.back} ${t('back')}</button>
      <h2 class="screen-title">${t('settingsTitle')}</h2>

      <div class="card col">
        <label class="label-sm">${t('yourName')}</label>
        <input class="field" id="nameInput" value="${escapeAttr(profile.firstName)}" />
      </div>

      <div class="card col">
        <label class="label-sm">${t('theme')}</label>
        <div class="toggle-pill" id="themeToggle">
          <button data-val="light" class="${theme === 'light' ? 'active' : ''}">${icon.sun} ${t('modeLight')}</button>
          <button data-val="dark" class="${theme === 'dark' ? 'active' : ''}">${icon.moon} ${t('modeDark')}</button>
        </div>
      </div>

      <div class="card col">
        <label class="label-sm">${t('language')}</label>
        <div class="toggle-pill" id="langToggle">
          <button data-val="en" class="${lang === 'en' ? 'active' : ''}">${t('english')}</button>
          <button data-val="ar" class="${lang === 'ar' ? 'active' : ''}">${t('arabic')}</button>
        </div>
      </div>

      <div class="card col">
        <label class="label-sm">${t('goalTracksLabel')}</label>
        <div class="goal-track-grid" id="goalGrid">
          ${GOAL_TRACKS.map((g) => `
            <button class="goal-track-card ${profile.goalTracks?.includes(g.id) ? 'selected' : ''}" data-id="${g.id}">
              <div class="icon-circle">${icon[g.icon]}</div>
              <div class="name">${t(g.label)}</div>
            </button>
          `).join('')}
        </div>
      </div>

      <div class="card col">
        <label class="label-sm">${t('dataLabel')}</label>
        <button class="btn secondary" id="exportBtn">${t('exportData')}</button>
        <button class="btn secondary" id="importBtn">${t('importData')}</button>
        <input type="file" id="importFile" accept="application/json" style="display:none" />
        <button class="btn secondary" id="resetBtn" style="color:var(--danger);">${t('resetData')}</button>
      </div>

      <div class="label-sm center-text">${t('localOnlyNotice')}</div>
    </div>
  `;

  root.querySelector('#backBtn').addEventListener('click', () => navigate('/'));

  root.querySelector('#nameInput').addEventListener('change', (e) => {
    const p = getProfile();
    p.firstName = e.target.value.trim();
    saveProfile(p);
  });

  root.querySelector('#themeToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    setTheme(btn.dataset.val);
    renderSettings(root);
  });

  root.querySelector('#langToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    setLang(btn.dataset.val);
    location.reload();
  });

  root.querySelectorAll('.goal-track-card').forEach((card) => {
    card.addEventListener('click', () => {
      const p = getProfile();
      const id = card.dataset.id;
      p.goalTracks = (p.goalTracks || []).includes(id)
        ? p.goalTracks.filter((g) => g !== id)
        : [...(p.goalTracks || []), id];
      saveProfile(p);
      renderSettings(root);
    });
  });

  root.querySelector('#exportBtn').addEventListener('click', () => {
    const data = exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `unmet-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  root.querySelector('#importBtn').addEventListener('click', () => root.querySelector('#importFile').click());
  root.querySelector('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      importAll(data);
      location.reload();
    } catch {
      alert(t('icsImportError'));
    }
  });

  root.querySelector('#resetBtn').addEventListener('click', () => {
    if (confirm(t('resetConfirm'))) {
      resetAll();
      location.reload();
    }
  });
}

function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;');
}
