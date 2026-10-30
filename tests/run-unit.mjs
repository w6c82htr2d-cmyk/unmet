// Runs the unit suite once per time zone (date bugs only show up away from UTC).
// Usage: npm test
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const ZONES = ['UTC', 'Asia/Riyadh', 'America/New_York', 'Asia/Tokyo'];
const files = readdirSync(new URL('./unit/', import.meta.url)).filter((f) => f.endsWith('.test.mjs')).map((f) => `tests/unit/${f}`);
let failed = false;
for (const tz of ZONES) {
  console.log(`\n=== TZ=${tz} ===`);
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], { stdio: 'inherit', env: { ...process.env, TZ: tz } });
  if (r.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
