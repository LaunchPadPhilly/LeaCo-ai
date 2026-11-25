import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { isAdmin, requireAdminApi } from '$lib/server/auth/guards';
import { ArchiveInput, archiveIssue, bringBack, listIssues, markContractorSent, refreshIssues } from '$lib/server/leaco/issues';
import type { Actions, PageServerLoad } from './$types';

/**
 * Issues (direction A phase 2). Everyone signed in can see them; only admins change their
 * status (owner decision A3). Actions re-check the admin role and validate input with Zod.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) throw redirect(303, `/api/auth/google/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
	await refreshIssues();
	const { issues, rules } = await listIssues();
	return { issues, rules, canChange: isAdmin(locals.user) };
};

const ids = (data: FormData) =>
	z
		.array(z.string().min(1).max(64))
		.min(1)
		.max(200)
		.safeParse(data.getAll('id').map(String));

export const actions: Actions = {
	contractor: async ({ request, locals }) => {
		const actor = requireAdminApi(locals.user).id;
		const data = await request.formData();
		const parsed = ids(data);
		if (!parsed.success) return fail(400, { message: 'Pick at least one issue.' });
		const note = z.string().trim().max(500).safeParse(String(data.get('note') ?? ''));
		for (const id of parsed.data) {
			const r = await markContractorSent(id, actor, note.success && note.data ? note.data : null);
			if (!r.ok) return fail(409, { message: r.message });
		}
		return { done: parsed.data.length === 1 ? 'Marked as contractor sent.' : `${parsed.data.length} issues marked as contractor sent.` };
	},

	archive: async ({ request, locals }) => {
		const actor = requireAdminApi(locals.user).id;
		const data = await request.formData();
		const parsed = ids(data);
		if (!parsed.success) return fail(400, { message: 'Pick at least one issue.' });
		for (const id of parsed.data) {
			const input = ArchiveInput.safeParse({
				id,
				reason: data.get('reason'),
				returnOn: data.get('returnOn') ? String(data.get('returnOn')) : undefined,
				note: data.get('note') ? String(data.get('note')) : undefined
			});
			if (!input.success) return fail(400, { message: 'Choose why it doesn’t need attention now. A note can be up to 500 characters.' });
			const r = await archiveIssue(input.data, actor);
			if (!r.ok) return fail(409, { message: r.message });
		}
		return { done: parsed.data.length === 1 ? 'Archived. It comes back if it gets worse.' : `${parsed.data.length} issues archived.` };
	},

	back: async ({ request, locals }) => {
		const actor = requireAdminApi(locals.user).id;
		const parsed = ids(await request.formData());
		if (!parsed.success) return fail(400, { message: 'Pick at least one issue.' });
		for (const id of parsed.data) {
			const r = await bringBack(id, actor);
			if (!r.ok) return fail(409, { message: r.message });
		}
		return { done: 'Back on the open list.' };
	}
};
