/**
 * Pull the current Amplified data for LeaCo into data/private/amplified/live.json.
 *
 *   pnpm run amplified:sync
 *
 * Read-only. The key comes from .env.local and is never printed. The dashboard also runs this
 * itself when its copy is over 15 minutes old.
 */
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const { syncAmplified } = await import('../src/lib/server/leaco/amplifiedSync.ts');
const result = await syncAmplified();

if (result.status !== 'ok') {
	console.error(`Amplified sync ${result.status}: ${result.reason}`);
	process.exit(1);
}
const s = result.snapshot;
const wells = Object.values(s.wells);
const count = (st: string | null) => wells.filter((w) => w.status === st).length;
const lastDay = s.leases.flatMap((l) => l.days.map((d) => d.day)).sort().at(-1) ?? 'none';
console.log(`Synced ${s.syncedAt}`);
console.log(`Wells linked: ${wells.length} (running ${count('Running')}, idle ${count('Idle')}, shutdown ${count('Shutdown')}, no reading ${count(null)})`);
console.log(`Not linked yet: ${Object.keys(s.notLinked).length}`);
console.log(`Open tickets: ${wells.reduce((n, w) => n + w.tickets.length, 0)}`);
console.log(`Leases: ${s.leases.length}, latest complete UTC day: ${lastDay}`);
if (s.warnings.length) console.log(`Warnings (${s.warnings.length}):\n  ${s.warnings.slice(0, 10).join('\n  ')}`);
