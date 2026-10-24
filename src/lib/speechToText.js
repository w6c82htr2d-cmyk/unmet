// Shared voice-dictation module used by both the Task Splitter and the Free-form Journal, so the
// recognition/transcript-assembly logic exists in exactly one place.
//
// Uses the browser's native Web Speech API (SpeechRecognition) — no server, no API key, no paid
// transcription service. Support varies by browser:
//   - Chrome / Edge (desktop + Android): supported. The audio is sent to that vendor's own cloud
//     speech service for recognition (Google's for Chrome, Microsoft's for Edge) — this is inherent
//     to how each browser implements the API; a web page has no way to force on-device processing
//     or to inspect/control where the audio goes.
//   - Safari (macOS/iOS): supported since Safari 14.1. Apple's docs don't commit to on-device vs.
//     server-side processing; it can vary by OS version, language, and device.
//   - Firefox: does not implement SpeechRecognition at all — isSpeechSupported() returns false and
//     the mic button is disabled with an explanatory label rather than failing silently.
// We never record or store raw audio ourselves — the API only ever hands back recognized text, so
// there is no audio buffer to retain even if we wanted to.
import { t, getLang } from '../i18n.js';
import { icon } from '../icons.js';

const SpeechRecognitionCtor = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

export function isSpeechSupported() {
  return !!SpeechRecognitionCtor;
}

let activeController = null;

// Called on every route change (see main.js) so a dictation session never keeps the microphone
// listening after the user navigates away from the page that started it.
export function stopActiveDictation() {
  if (activeController) activeController.stop();
}

function needsSeparator(text) {
  return text.length > 0 && !/\s$/.test(text);
}

function createRecognizer({ lang, onUpdate, onStart, onEnd, onError }) {
  const recognition = new SpeechRecognitionCtor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = lang;

  let baseText = '';
  let active = false;

  const controller = {
    start(currentText) {
      if (active) return;
      baseText = currentText || '';
      activeController = controller;
      try {
        recognition.start();
      } catch {
        // Calling start() while already starting throws in some browsers; onerror covers real failures.
      }
    },
    stop() {
      if (active) recognition.stop();
    },
    get isActive() { return active; },
  };

  recognition.onstart = () => { active = true; onStart && onStart(); };
  recognition.onend = () => {
    active = false;
    if (activeController === controller) activeController = null;
    onEnd && onEnd();
  };
  recognition.onerror = (e) => { onError && onError(e.error); };

  // Rebuilds the full field text from scratch on every event rather than appending interim results,
  // which is what prevents duplicated words: interim text is always *replaced*, never accumulated,
  // and the final transcript for this session is recomputed in full (summing every isFinal result)
  // each time instead of being appended to piecemeal.
  recognition.onresult = (event) => {
    let finalText = '';
    let interim = '';
    for (let i = 0; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) finalText += res[0].transcript;
      else interim += res[0].transcript;
    }
    const sep = needsSeparator(baseText) ? ' ' : '';
    onUpdate && onUpdate(baseText + sep + finalText + interim);
  };

  return controller;
}

export function micButtonHtml(id) {
  return `
    <span class="mic-wrap">
      <button type="button" class="mic-btn" id="${id}" title="${t('startDictation')}">${icon.mic}</button>
      <span class="mic-status" id="${id}-status"></span>
    </span>
  `;
}

// Wires a mic button (from micButtonHtml) to a text input/textarea already in the DOM. Returns the
// recognition controller (or null if unsupported) so the caller can stop() it explicitly, e.g.
// before its own re-render destroys the button/field it's bound to.
export function wireMicButton(root, id, field) {
  const btn = root.querySelector(`#${id}`);
  const statusEl = root.querySelector(`#${id}-status`);
  if (!btn || !field) return null;

  if (!isSpeechSupported()) {
    btn.disabled = true;
    btn.classList.add('unsupported');
    btn.title = t('voiceUnsupported');
    if (statusEl) statusEl.textContent = t('voiceUnsupportedShort');
    return null;
  }

  // onerror is reliably followed by an onend right after (the recognizer stops itself on error), so
  // onEnd must not blindly clear the status text — otherwise an error message set a moment earlier
  // gets wiped before anyone can read it. Track whether this session ended in an error instead.
  let endedWithError = false;

  const controller = createRecognizer({
    lang: getLang() === 'ar' ? 'ar-SA' : 'en-US',
    onUpdate: (full) => {
      field.value = full;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    },
    onStart: () => {
      endedWithError = false;
      btn.classList.add('listening');
      btn.title = t('stopDictation');
      if (statusEl) statusEl.textContent = t('listeningStatus');
    },
    onEnd: () => {
      btn.classList.remove('listening');
      btn.title = t('startDictation');
      if (statusEl && !endedWithError) statusEl.textContent = '';
    },
    onError: (err) => {
      endedWithError = true;
      btn.classList.remove('listening');
      btn.title = t('startDictation');
      if (statusEl) {
        statusEl.textContent = (err === 'not-allowed' || err === 'permission-denied' || err === 'service-not-allowed')
          ? t('micPermissionDenied')
          : t('micErrorGeneric');
      }
    },
  });

  btn.addEventListener('click', () => {
    if (controller.isActive) controller.stop();
    else controller.start(field.value);
  });

  return controller;
}
