import '$lib/server/load-local-env';

import type { Handle, ServerInit } from '@sveltejs/kit';
import { sessionCookieName, getSessionUser } from '$lib/server/auth/session';
import { LIVE_STALE_MS } from '$lib/leaco/ops/live';
import { startAmplifiedSchedule } from '$lib/server/leaco/amplifiedSync';
import { refreshIssues } from '$lib/server/leaco/issues';

/**
 * Runs once per server process: start the 15-min Amplified refresh for the dashboard, and
 * check issues on the same beat (a minute later, so it reads the fresh copy). Issue durations
 * ("idle for 24 h") count from these checks as well as from page loads.
 */
export const init: ServerInit = () => {
	startAmplifiedSchedule();
	setTimeout(() => {
		void refreshIssues();
		setInterval(() => void refreshIssues(), LIVE_STALE_MS).unref?.();
	}, 60_000).unref?.();
};

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(sessionCookieName);
	event.locals.user = await getSessionUser(token);
	return resolve(event);
};
