import '$lib/server/load-local-env';

import type { Handle, ServerInit } from '@sveltejs/kit';
import { sessionCookieName, getSessionUser } from '$lib/server/auth/session';
import { startAmplifiedSchedule } from '$lib/server/leaco/amplifiedSync';

/** Runs once per server process: start the 15-min Amplified refresh for the dashboard. */
export const init: ServerInit = () => {
	startAmplifiedSchedule();
};

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(sessionCookieName);
	event.locals.user = await getSessionUser(token);
	return resolve(event);
};
