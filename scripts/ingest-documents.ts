/**
 * Sync LeaCo's Dropbox folder into the Document tables (ADR 0003, Play 03b).
 *
 *   pnpm run documents:ingest                 # new and changed files only
 *   pnpm run documents:ingest -- --dry-run    # list what would change; writes nothing
 *   pnpm run documents:ingest -- --force      # re-read every file
 *   pnpm run documents:ingest -- --verbose    # also print relative paths (never contents)
 *
 * Exit codes: 0 ok, 1 failed, 3 another run is in progress (ALREADY_RUNNING).
 * Deployed, it runs as an ECS task on the MCP image, which can reach the private RDS: hourly
 * from EventBridge Scheduler (Play 14 section L) or by hand (Play 14 section E).
 *
 * Every real run (not --dry-run) also prints exactly one JSON line,
 *   {"event":"ingest.run","outcome":"OK"|"PARTIAL"|"FAILED"|"SKIPPED", ...counts}
 * which the CloudWatch metric filters in infra/modules/environment/ingest-schedule.tf count.
 * It carries counts and error codes only, never file names or contents.
 */
import { existsSync } from 'node:fs';

// Load .env.local before anything instantiates Prisma (CLAUDE.md, "Environment loading").
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

// pnpm passes a literal "--" through; ignore it.
const args = new Set(process.argv.slice(2).filter((a) => a !== '--'));
const unknown = [...args].filter((a) => !['--dry-run', '--force', '--verbose'].includes(a));
if (unknown.length) {
	console.error(`Unknown option(s): ${unknown.join(' ')}. Use --dry-run, --force, --verbose.`);
	process.exit(2);
}

const { runIngest } = await import('../src/lib/server/documents/ingest.ts');
const { DropboxError } = await import('../src/lib/server/dropbox/client.ts');
const { prisma } = await import('../src/lib/server/prisma.ts');

const started = Date.now();
const seconds = () => Math.round((Date.now() - started) / 1000);
const dryRun = args.has('--dry-run');

/** The one structured line per run that the alarms read. Counts and codes only. */
function logRun(outcome: 'OK' | 'PARTIAL' | 'FAILED' | 'SKIPPED', fields: Record<string, string | number> = {}) {
	if (dryRun) return;
	console.log(JSON.stringify({ event: 'ingest.run', outcome, ...fields, seconds: seconds() }));
}

try {
	const result = await runIngest({
		dryRun,
		force: args.has('--force'),
		verbose: args.has('--verbose'),
		log: (line) => console.log(line)
	});

	if (result.status === 'already_running') {
		console.error(`ALREADY_RUNNING: another sync started at ${result.runningSince}.`);
		logRun('SKIPPED', { reason: 'ALREADY_RUNNING' });
		process.exitCode = 3;
	} else if (result.status === 'failed') {
		console.error(`INGEST_FAILED: ${result.reason}`);
		logRun('FAILED', { reason: 'RUN_FAILED' });
		process.exitCode = 1;
	} else {
		const c = result.counts;
		const mode = result.dryRun ? 'DRY_RUN' : 'INGEST_OK';
		console.log(
			`${mode} root=${result.rootPath} listed=${c.listed} added=${c.added} updated=${c.updated} moved=${c.moved} removed=${c.removed} unchanged=${c.unchanged}` +
				(result.dryRun ? '' : ` failed=${c.failed} no_text=${c.noText} attachments=${c.attachments}`) +
				` largest_file_mb=${(c.largestFileBytes / 1_048_576).toFixed(1)} seconds=${seconds()}`
		);
		logRun(c.failed > 0 ? 'PARTIAL' : 'OK', {
			listed: c.listed,
			added: c.added,
			updated: c.updated,
			moved: c.moved,
			removed: c.removed,
			unchanged: c.unchanged,
			failed: c.failed,
			noText: c.noText
		});
		if (result.changes) {
			for (const [label, paths] of Object.entries(result.changes)) for (const path of paths) console.log(`  ${label} ${path}`);
		}
	}
} catch (error) {
	// DropboxError messages are written to be safe to print; anything else prints its type only.
	console.error(error instanceof DropboxError ? `INGEST_FAILED ${error.code}: ${error.message}` : `INGEST_FAILED: ${error instanceof Error ? error.name : 'error'}`);
	logRun('FAILED', { reason: error instanceof DropboxError ? error.code : 'ERROR' });
	process.exitCode = 1;
} finally {
	await prisma.$disconnect();
}
