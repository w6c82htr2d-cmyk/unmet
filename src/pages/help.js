import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';

const TABS = [
  { icon: 'home', label: 'navHome', body: 'helpHome' },
  { icon: 'calendar', label: 'navCalendar', body: 'helpCalendar' },
  { icon: 'journal', label: 'navJournal', body: 'helpJournal' },
  { icon: 'tasks', label: 'navTasks', body: 'helpTasks' },
  { icon: 'checkin', label: 'navCheckin', body: 'helpCheckin' },
];

const TIPS = ['helpTip1', 'helpTip2', 'helpTip3', 'helpTip4', 'helpTip5'];

export function renderHelp(root) {
  root.innerHTML = `
    <div class="page">
      <button class="back-row" id="backBtn">${icon.back} ${t('back')}</button>
      <h2 class="screen-title">${t('helpTitle')}</h2>

      <div>
        <div class="section-head" style="margin-bottom:8px;"><span class="title">${t('helpTabsHeading')}</span></div>
        <div class="col">
          ${TABS.map((tab) => `
            <div class="card row">
              <div class="icon-circle">${icon[tab.icon]}</div>
              <div class="grow">
                <div style="font-weight:700; font-size:13px;">${t(tab.label)}</div>
                <div style="font-size:11.5px; color:var(--text-muted);">${t(tab.body)}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div>
        <div class="section-head" style="margin-bottom:8px;"><span class="title">${t('helpTipsHeading')}</span></div>
        <div class="card col">
          ${TIPS.map((key, i) => `
            <div class="row" style="align-items:flex-start; gap:8px;">
              <span class="chip solid" style="min-width:20px; justify-content:center;">${i + 1}</span>
              <span style="font-size:12.5px; line-height:1.5;">${t(key)}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div>
        <div class="section-head" style="margin-bottom:8px;"><span class="title">${t('helpDataHeading')}</span></div>
        <div class="card" style="font-size:12.5px; line-height:1.6;">${t('helpDataBody')}</div>
      </div>
    </div>
  `;

  root.querySelector('#backBtn').addEventListener('click', () => navigate('/'));
}
