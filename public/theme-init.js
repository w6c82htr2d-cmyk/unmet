// Runs before the page paints (plain blocking script in <head>) so the saved theme and language
// direction apply immediately, without a flash of the wrong theme or a left-to-right flip.
// Mirrors the rules in src/theme.js and src/i18n.js; those modules take over once loaded.
(function () {
  var html = document.documentElement;
  try {
    var theme = localStorage.getItem('unmet_theme');
    if (theme !== 'light' && theme !== 'dark') {
      theme = localStorage.getItem('unmet_profile') !== null ? 'light' : 'dark';
    }
    html.setAttribute('data-theme', theme);
    if (localStorage.getItem('unmet_lang') === 'ar') {
      html.setAttribute('lang', 'ar');
      html.setAttribute('dir', 'rtl');
    }
  } catch (e) {
    // Storage blocked: keep the defaults from index.html.
  }
})();
