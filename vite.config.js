import { defineConfig, loadEnv } from 'vite';
import { readFileSync } from 'node:fs';
import { readConfig } from './src/lib/supabaseConfig.js';

// Build-time guard for accounts. When Supabase settings are present, refuse to build if:
//  - the key looks like a secret (service-role / sb_secret_), so it can never be shipped, or
//  - the project isn't allowed by the Content-Security-Policy in vercel.json (sign-in would be
//    blocked in production; add exactly that origin to connect-src).
function supabaseGuard(mode) {
  return {
    name: 'unmet-supabase-guard',
    buildStart() {
      const env = loadEnv(mode, process.cwd(), 'VITE_');
      if (!env.VITE_SUPABASE_URL && !env.VITE_SUPABASE_PUBLISHABLE_KEY) return; // guest-only build
      const cfg = readConfig(env);
      if (!cfg.enabled) this.error(`Supabase settings rejected (${cfg.reason}). Use the project URL and its publishable/anon key — never a secret key.`);
      // vercel.json headers only apply to deployed builds; local test builds and the dev server skip this.
      if (mode === 'test' || mode === 'development') return;
      const csp = JSON.parse(readFileSync('vercel.json', 'utf8')).headers
        .flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')?.value || '';
      const connect = (csp.match(/connect-src ([^;]*)/) || [])[1]?.split(/\s+/) || [];
      if (!connect.includes(cfg.url)) this.error(`vercel.json connect-src must include ${cfg.url} for sign-in to work.`);
    },
  };
}

export default defineConfig(({ mode }) => ({
  server: {
    port: 5173,
  },
  plugins: [supabaseGuard(mode)],
}));
