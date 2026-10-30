const THEME_KEY = 'unmet_theme';
const PROFILE_KEY = 'unmet_profile';

// New users start in dark mode. People who were already using UNMET before dark became the default
// never picked a theme (no stored key) and were seeing light, so their light theme is written down
// once here instead of switching it under them.
function initialTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  const existingUser = localStorage.getItem(PROFILE_KEY) !== null;
  const theme = existingUser ? 'light' : 'dark';
  // Stored either way, so a new user who later creates a profile isn't mistaken for an existing one.
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage unavailable: the choice just won't persist.
  }
  return theme;
}

let currentTheme = initialTheme();

export function getTheme() {
  return currentTheme;
}

export function setTheme(theme) {
  currentTheme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Applies for this visit even if it can't be remembered.
  }
  document.documentElement.setAttribute('data-theme', theme);
}

document.documentElement.setAttribute('data-theme', currentTheme);

// Another tab changed the theme: follow it without writing anything.
export function applyThemeFromStorage() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored !== 'light' && stored !== 'dark') return;
  currentTheme = stored;
  document.documentElement.setAttribute('data-theme', stored);
}
