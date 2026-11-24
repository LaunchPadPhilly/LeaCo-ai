import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The dashboard is now the signed-in home page. Keep old links and bookmarks working.
export const load: PageServerLoad = () => {
	throw redirect(308, '/');
};
