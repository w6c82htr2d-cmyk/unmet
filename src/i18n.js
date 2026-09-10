import { translations } from './translations.js';

const LANG_KEY = 'unmet_lang';
let currentLang = localStorage.getItem(LANG_KEY) || 'en';

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  currentLang = lang;
  localStorage.setItem(LANG_KEY, lang);
  applyDocAttrs();
}

export function applyDocAttrs() {
  document.documentElement.lang = currentLang;
  document.documentElement.dir = currentLang === 'ar' ? 'rtl' : 'ltr';
}

export function t(key, vars) {
  const dict = translations[currentLang] || translations.en;
  let str = dict[key] !== undefined ? dict[key] : (translations.en[key] !== undefined ? translations.en[key] : key);
  if (vars) {
    Object.keys(vars).forEach((k) => {
      str = str.replace(`{${k}}`, vars[k]);
    });
  }
  return str;
}

applyDocAttrs();
