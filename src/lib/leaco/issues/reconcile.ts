import { isVisible, type Condition, type ConditionRun, type IssueKind } from './conditions';
import type { Rules } from './rules';

/**
 * How the stored issues should change after a look at the data (pure, so it can be tested
 * without a database). Status changes made by people (contractor sent, archived) are kept;
 * only the data opens and resolves issues, and an archived issue returns on its return date.
 */
export type StoredIssue = {
	id: string;
	assetKey: string;
	kind: IssueKind;
	status: 'OPEN' | 'CONTRACTOR_SENT' | 'ARCHIVED';
	firstSeenAt: Date;
	/** YYYY-MM-DD, or null. */
	returnOn: string | null;
};

export type ReconcilePlan = {
	create: Condition[];
	/** Still true: refresh the description and last-seen time. */
	update: { id: string; condition: Condition }[];
	/** Archived issues whose return date has come: back to OPEN. */
	reopen: { id: string; condition: Condition }[];
	/** Cleared after people could see it: RESOLVED. */
	resolve: string[];
	/** Cleared before its rule's wait was up (e.g. idle for 3 h): never shown, so dropped. */
	drop: string[];
};

export function planReconcile(existing: StoredIssue[], run: ConditionRun, rules: Rules, now: number): ReconcilePlan {
	const today = new Date(now).toISOString().slice(0, 10);
	const byId = new Map(existing.map((e) => [`${e.assetKey}|${e.kind}`, e]));
	const seen = new Set<string>();
	const plan: ReconcilePlan = { create: [], update: [], reopen: [], resolve: [], drop: [] };

	for (const c of run.conditions) {
		const id = `${c.assetKey}|${c.kind}`;
		seen.add(id);
		const ex = byId.get(id);
		if (!ex) plan.create.push(c);
		else if (ex.status === 'ARCHIVED' && ex.returnOn !== null && ex.returnOn <= today) plan.reopen.push({ id: ex.id, condition: c });
		else plan.update.push({ id: ex.id, condition: c });
	}

	const observed = new Set(run.observed);
	for (const ex of existing) {
		if (seen.has(`${ex.assetKey}|${ex.kind}`) || !observed.has(ex.kind)) continue;
		if (ex.status === 'OPEN' && !isVisible(ex, rules, now)) plan.drop.push(ex.id);
		else plan.resolve.push(ex.id);
	}
	return plan;
}
