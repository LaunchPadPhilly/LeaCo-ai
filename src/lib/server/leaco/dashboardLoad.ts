import { opsFromAmplified } from '$lib/leaco/ops/fromAmplified';
import type { DashboardLoad } from '$lib/leaco/ops/live';
import { getLiveState, readLiveSnapshot } from './amplifiedSync';
import { loadOpsData } from './opsData';

export type { DashboardLoad };

/**
 * Data for the LeaCo dashboard (the signed-in home page). Callers check sign-in first.
 *
 * - Local, with the private daily reports: the report view, plus the saved Amplified copy
 *   (the page refreshes it in the background when stale).
 * - No private files (UAT, production): everything from the Amplified API, with public state
 *   records filling locations. The first request after a deploy waits for one pull.
 */
export async function loadDashboard(): Promise<DashboardLoad> {
	const result = await loadOpsData();
	if (result.status === 'ok') return { state: 'ok', ops: result.data, reason: null, live: await readLiveSnapshot() };
	if (result.status === 'invalid') return { state: 'invalid', ops: null, reason: result.reason, live: await readLiveSnapshot() };

	const live = await getLiveState();
	const snapshot = live.status === 'ok' ? live.snapshot : live.status === 'error' ? live.snapshot : null;
	if (snapshot) return { state: 'ok', ops: opsFromAmplified(snapshot), reason: null, live };
	return { state: 'missing', ops: null, reason: live.status === 'none' || live.status === 'error' ? live.reason : null, live };
}
