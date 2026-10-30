// Shared test helpers: an in-memory localStorage and a frozen clock, so db.js can run under Node.
const RealDate = globalThis.Date;

// quota: max total characters (keys + values) before setItem throws QuotaExceededError, like a
// browser; settable later via localStorage.setQuota(n) (null = unlimited).
export function installLocalStorage() {
  const store = new Map();
  let quota = null;
  const size = () => [...store].reduce((n, [k, v]) => n + k.length + v.length, 0);
  const ls = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      v = String(v);
      const next = size() - (store.has(k) ? k.length + store.get(k).length : 0) + k.length + v.length;
      if (quota !== null && next > quota) {
        const e = new Error('The quota has been exceeded.');
        e.name = 'QuotaExceededError';
        throw e;
      }
      store.set(k, v);
    },
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
    setQuota: (n) => { quota = n; },
    usedChars: size,
  };
  // Object.keys(localStorage) lists stored keys in browsers; mirror that.
  globalThis.localStorage = new Proxy(ls, {
    ownKeys: () => [...store.keys()],
    getOwnPropertyDescriptor: (t, k) => (store.has(k) ? { enumerable: true, configurable: true, value: store.get(k) } : Reflect.getOwnPropertyDescriptor(t, k)),
  });
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
