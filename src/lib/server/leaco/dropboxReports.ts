import type { DailyReport } from '$lib/leaco/dailyReport';
import { parseReportText, reportDateFromName } from '$lib/leaco/reportText';
import { prisma } from '$lib/server/prisma';

/**
 * The LeaCo Daily Reports for the dashboard, read from the documents the Dropbox document
 * source stored (ADR 0003): PDFs in the "Daily Reports" folder, including PDFs attached to
 * emails there. The dashboard never calls Dropbox itself, so the web container needs only
 * DATABASE_URL. The sync (`documents:ingest`) keeps the table current.
 *
 * Parsed reports are kept in memory for a few minutes; the document table only changes when a
 * sync runs. Any failure leaves the dashboard on Amplified data alone, with the reason shown.
 */

const FOLDER = 'Daily Reports';
const CACHE_MS = 5 * 60_000;

export type ReportsState = {
	reports: DailyReport[];
	/** Report files found but not used, with a short reason (never file contents). */
	skipped: { name: string; reason: string }[];
	/** Set when the documents couldn't be read at all. */
	error: string | null;
};

let cached: { at: number; state: ReportsState } | null = null;

export async function loadDropboxReports(): Promise<ReportsState> {
	if (cached && Date.now() - cached.at < CACHE_MS) return cached.state;
	const state = await readReports();
	cached = { at: Date.now(), state };
	return state;
}

async function readReports(): Promise<ReportsState> {
	let docs;
	try {
		docs = await prisma.document.findMany({
			where: {
				source: 'dropbox',
				status: 'ACTIVE',
				kind: 'PDF',
				OR: [{ folder: { equals: FOLDER, mode: 'insensitive' } }, { folder: { startsWith: `${FOLDER}/`, mode: 'insensitive' } }]
			},
			select: {
				name: true,
				path: true,
				modifiedAt: true,
				extraction: true,
				extractionNote: true,
				pages: { select: { text: true }, orderBy: { pageNumber: 'asc' } }
			},
			orderBy: { modifiedAt: 'asc' }
		});
	} catch {
		// Table missing (migration not applied) or database unreachable. No details: they may
		// include the connection string.
		return { reports: [], skipped: [], error: 'The daily reports couldn’t be read from the document store.' };
	}

	const byDate = new Map<string, DailyReport>();
	const skipped: ReportsState['skipped'] = [];
	for (const doc of docs) {
		if (!/daily[ _-]?report|^\d{4}-\d{2}-\d{2}/i.test(doc.name)) continue;
		if (doc.extraction !== 'OK') {
			skipped.push({ name: doc.name, reason: doc.extractionNote ?? `Text not readable (${doc.extraction}).` });
			continue;
		}
		const date = reportDateFromName(doc.name, doc.modifiedAt);
		if (!date) {
			skipped.push({ name: doc.name, reason: 'No report date in the file name.' });
			continue;
		}
		const result = parseReportText(
			doc.pages.map((p) => p.text),
			date
		);
		if (!result.ok) {
			skipped.push({ name: doc.name, reason: result.reason });
			continue;
		}
		// Ordered by modifiedAt, so a re-sent report for the same day replaces the earlier one.
		byDate.set(date, result.report);
	}
	const reports = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
	return { reports, skipped, error: null };
}
