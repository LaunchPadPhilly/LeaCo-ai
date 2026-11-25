import { loadDashboard } from '$lib/server/leaco/dashboardLoad';
import { refreshIssues, setAsideIssues } from '$lib/server/leaco/issues';
import type { PageServerLoad } from './$types';

// Signed-in home is the LeaCo operations dashboard. Any signed-in user may view it: sign-in is
// already limited to the allowed Workspace domains. A dedicated LeaCo data scope
// (requireScopePage) is a follow-up; see docs/leaco/PLAN.md.
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return { signedIn: false as const };
	const dashboard = await loadDashboard();
	// Issues people archived or sent a contractor to stay off "Needs a contractor". If the issue
	// tables can't be read, the Overview still works and simply hides nothing.
	const setAside = await refreshIssues(dashboard)
		.then(setAsideIssues)
		.catch(() => ({ keys: [] as string[], archived: 0, contractorSent: 0 }));
	return { signedIn: true as const, dashboard, setAside };
};
