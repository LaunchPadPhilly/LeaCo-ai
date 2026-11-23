import { redirect } from '@sveltejs/kit';
import { readLiveSnapshot } from '$lib/server/leaco/amplifiedSync';
import { loadOpsData } from '$lib/server/leaco/opsData';
import type { PageServerLoad } from './$types';

// Any signed-in user may view this for now: sign-in is already limited to the allowed
// Workspace domains. A dedicated LeaCo data scope (requireScopePage) is a follow-up; see
// docs/leaco/PLAN.md.
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		throw redirect(303, `/api/auth/google/login?redirectTo=${encodeURIComponent(url.pathname)}`);
	}

	// The saved Amplified snapshot loads with the page; the page refreshes it from Amplified
	// in the background when it is stale, so the first paint never waits on the API.
	const [result, live] = await Promise.all([loadOpsData(), readLiveSnapshot()]);
	if (result.status === 'ok') return { state: 'ok' as const, ops: result.data, reason: null, live };
	return { state: result.status, ops: null, reason: result.status === 'invalid' ? result.reason : null, live };
};
