import { opsFromAmplified } from '$lib/leaco/ops/fromAmplified';
import type { DashboardLoad } from '$lib/leaco/ops/live';
import { getLiveState, readLiveSnapshot } from './amplifiedSync';
import { loadDropboxReports, type ReportsState } from './dropboxReports';
import { loadOpsData } from './opsData';

export type { DashboardLoad };

/**
 * Data for the LeaCo dashboard (the signed-in home page). Callers check sign-in first.
 *
 * - Local, with the private daily reports: the report view, plus the saved Amplified copy
 *   (the page refreshes it in the background when stale).
 * - No private files (UAT, production): everything from the Amplified API, with public state
 *   records filling locations and the Dropbox daily reports (when synced) filling water
 *   injected, wells running and injectors taking water. The first request after a deploy
 *   waits for one Amplified pull.
 */
export async function loadDashboard(): Promise<DashboardLoad> {
	const result = await loadOpsData();
	if (result.status === 'ok') return { state: 'ok', ops: result.data, reason: null, live: await readLiveSnapshot(), reports: [], reportsNote: null };
	if (result.status === 'invalid') return { state: 'invalid', ops: null, reason: result.reason, live: await readLiveSnapshot(), reports: [], reportsNote: null };

	const [live, reportsState] = await Promise.all([getLiveState(), loadDropboxReports()]);
	const { reports } = reportsState;
	const reportsNote = noteFor(reportsState);
	const snapshot = live.status === 'ok' ? live.snapshot : live.status === 'error' ? live.snapshot : null;
	if (snapshot) return { state: 'ok', ops: opsFromAmplified(snapshot, reports), reason: null, live, reports, reportsNote };
	return {
		state: 'missing',
		ops: null,
		reason: live.status === 'none' || live.status === 'error' ? live.reason : null,
		live,
		reports,
		reportsNote
	};
}

function noteFor(s: ReportsState): string | null {
	if (s.error) return s.error;
	if (!s.skipped.length) return null;
	const n = s.skipped.length;
	const first = s.skipped[0];
	return `${n} daily report file${n > 1 ? 's weren’t' : ' wasn’t'} used (${first.name}: ${first.reason}${n > 1 ? '; and others' : ''}).`;
}
