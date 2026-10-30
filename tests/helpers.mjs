// Shared test helpers: an in-memory localStorage and a frozen clock, so db.js can run under Node.
const RealDate = globalThis.Date;

export function installLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  return globalThis.localStorage;
}

// Freeze "now" at an absolute instant (e.g. '2026-10-25T01:30:00+03:00'); local getters then
// follow the process TZ, exactly like a browser in that zone.
export function freezeTime(iso) {
  const fixed = new RealDate(iso).getTime();
  class FakeDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixed]));
    }
    static now() {
      return fixed;
    }
  }
  globalThis.Date = FakeDate;
}

export function restoreTime() {
  globalThis.Date = RealDate;
}
