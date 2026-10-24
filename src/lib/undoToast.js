// A single "Removed · Undo" snackbar shared by the app. It lives on document.body rather than inside
// a page, so the page's full innerHTML re-render after a delete doesn't wipe it out. Only one toast
// exists at a time: showing a new one (or navigating away) dismisses the previous one, and its
// undo is no longer offered.
let current = null;

export function showUndoToast(message, undoLabel, onUndo, ms = 6000) {
  dismissUndoToast();
  const el = document.createElement('div');
  el.className = 'undo-toast';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  const text = document.createElement('span');
  text.className = 'undo-toast-text';
  text.textContent = message;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'undo-toast-btn';
  btn.textContent = undoLabel;
  el.append(text, btn);
  document.body.appendChild(el);

  const toast = { el, timer: setTimeout(dismissUndoToast, ms) };
  current = toast;
  btn.addEventListener('click', () => {
    dismissUndoToast();
    onUndo();
  });
}

export function dismissUndoToast() {
  if (!current) return;
  clearTimeout(current.timer);
  current.el.remove();
  current = null;
}
