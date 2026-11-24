import { loadDashboard } from '$lib/server/leaco/dashboardLoad';
import type { PageServerLoad } from './$types';

// Signed-in home is the LeaCo operations dashboard. Any signed-in user may view it: sign-in is
// already limited to the allowed Workspace domains. A dedicated LeaCo data scope
// (requireScopePage) is a follow-up; see docs/leaco/PLAN.md.
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return { signedIn: false as const };
	return { signedIn: true as const, dashboard: await loadDashboard() };
};
