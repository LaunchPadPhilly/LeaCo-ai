import { readFile } from 'node:fs/promises';
import { dailyReportsFileSchema, type DailyReport } from '$lib/leaco/dailyReport';

/**
 * Interim source: the parsed Daily Reports from the starter kit, kept in gitignored
 * `data/private/` (PLAN decision D5). It is absent from Docker images on purpose
 * (.dockerignore), so deployed environments show "No data" until the Amplified sync
 * (PLAN §2a) writes to Postgres. Paths are relative to the repository root, like every
 * other loader here.
 */
export const DAILY_REPORTS_PATH = 'data/private/daily_parsed.json';

export type DailyReportsResult =
	| { status: 'ok'; reports: DailyReport[]; source: string }
	| { status: 'missing' }
	| { status: 'invalid'; reason: string };

export async function loadDailyReports(): Promise<DailyReportsResult> {
	let raw: string;
	try {
		raw = await readFile(DAILY_REPORTS_PATH, 'utf8');
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' };
		throw err;
	}

	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return { status: 'invalid', reason: 'The file is not valid JSON.' };
	}

	const parsed = dailyReportsFileSchema.safeParse(json);
	if (!parsed.success) {
		// Report where the shape broke, never the data itself.
		const issue = parsed.error.issues[0];
		return { status: 'invalid', reason: `Unexpected shape at ${issue.path.join('.') || '(root)'}: ${issue.message}` };
	}

	const mismatched = Object.entries(parsed.data).find(([key, report]) => key !== report.date);
	if (mismatched) {
		return { status: 'invalid', reason: `Entry ${mismatched[0]} is labelled ${mismatched[1].date}.` };
	}

	return { status: 'ok', reports: Object.values(parsed.data), source: 'LeaCo Daily Reports (parsed copy from the starter kit)' };
}
