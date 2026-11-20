import { error, json } from '@sveltejs/kit';
import { readLiveSnapshot, syncAmplified } from '$lib/server/leaco/amplifiedSync';
import type { RequestHandler } from './$types';

/**
 * Live Amplified data for the dashboard. GET returns the saved snapshot; POST pulls fresh data
 * from Amplified first (read-only upstream, ~7 requests). Same access as /dashboard: any
 * signed-in user. The session cookie is SameSite=Lax, so a cross-site POST arrives without it
 * and is refused here.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Authentication required');
	return json(await readLiveSnapshot(), { headers: { 'cache-control': 'no-store' } });
};

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Authentication required');
	return json(await syncAmplified(), { headers: { 'cache-control': 'no-store' } });
};
