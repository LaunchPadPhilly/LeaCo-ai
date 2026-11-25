import { fail, redirect } from '@sveltejs/kit';
import { RULE_KEYS } from '$lib/leaco/issues/rules';
import { isAdmin, requireAdminApi } from '$lib/server/auth/guards';
import { listIssues, RulesInput, saveRules } from '$lib/server/leaco/issues';
import type { Actions, PageServerLoad } from './$types';

/** Issue rules: everyone can read them; only admins change them (owner decision A3). */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) throw redirect(303, `/api/auth/google/login?redirectTo=${encodeURIComponent(url.pathname)}`);
	const { issues, rules } = await listIssues();
	const openByKind: Record<string, number> = {};
	for (const i of issues) if (i.status === 'OPEN' && i.visible) openByKind[i.kind] = (openByKind[i.kind] ?? 0) + 1;
	return { rules, openByKind, canChange: isAdmin(locals.user) };
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		const actor = requireAdminApi(locals.user).id;
		const data = await request.formData();
		const num = (v: FormDataEntryValue | null) => (v === null || v === '' ? null : Number(v));
		const raw = Object.fromEntries(
			RULE_KEYS.map((k) => [
				k,
				{
					enabled: data.get(`${k}.enabled`) === 'on',
					threshold: num(data.get(`${k}.threshold`)),
					option: data.get(`${k}.option`) ? String(data.get(`${k}.option`)) : null
				}
			])
		);
		const parsed = RulesInput.safeParse(raw);
		if (!parsed.success) return fail(400, { message: 'Each number must be a whole number.' });
		await saveRules(parsed.data, actor);
		return { done: 'Rules saved. Open issues were checked against them.' };
	}
};
