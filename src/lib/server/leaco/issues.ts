import { z } from 'zod';
import { findConditions, isVisible, type IssueKind } from '$lib/leaco/issues/conditions';
import { planReconcile, type StoredIssue } from '$lib/leaco/issues/reconcile';
import { mergeRules, RULE_DEFS, RULE_KEYS, type Rules } from '$lib/leaco/issues/rules';
import type { DashboardLoad } from '$lib/leaco/ops/live';
import { prisma } from '$lib/server/prisma';
import { loadDashboard } from './dashboardLoad';

/**
 * Issues (direction A phase 2): the dashboard's problems, kept so people can act on them.
 *
 * - `refreshIssues` looks at the current data and opens, updates, reopens and resolves rows.
 *   It runs on the Amplified sync schedule and when the Overview or Issues page loads, at most
 *   once a minute. Only kinds whose source was actually read are resolved.
 * - People change status through `markContractorSent`, `archiveIssue` and `bringBack`; the
 *   routes allow only admins (owner decision A3). Every change is an AuditEvent.
 */

export type IssueRow = {
	id: string;
	assetKey: string;
	kind: IssueKind;
	status: 'OPEN' | 'CONTRACTOR_SENT' | 'ARCHIVED' | 'RESOLVED';
	assetName: string;
	property: string | null;
	detail: string;
	source: string;
	firstSeenAt: string;
	lastSeenAt: string;
	resolvedAt: string | null;
	archiveReason: 'NORMAL_FOR_WELL' | 'NOT_URGENT' | 'SCHEDULED' | 'DATA_PROBLEM' | null;
	returnOn: string | null;
	note: string | null;
	updatedAt: string;
	/** Has lasted as long as its rule asks (always true except while waiting). */
	visible: boolean;
};

const THROTTLE_MS = 60_000;
let lastRun = 0;
let running: Promise<void> | null = null;

export async function loadRules(): Promise<Rules> {
	return mergeRules(await prisma.leacoIssueRule.findMany());
}

/** Look at the data and update the stored issues. Never throws: a failure leaves issues as they were. */
export function refreshIssues(dashboard?: DashboardLoad, force = false): Promise<void> {
	if (running) return running;
	if (!force && Date.now() - lastRun < THROTTLE_MS) return Promise.resolve();
	running = (async () => {
		try {
			await reconcile(dashboard ?? (await loadDashboard()));
		} catch (err) {
			console.error('[issues] refresh failed:', err instanceof Error ? err.message : 'unknown error');
		} finally {
			lastRun = Date.now();
			running = null;
		}
	})();
	return running;
}

async function reconcile(dashboard: DashboardLoad): Promise<void> {
	const live = dashboard.live.status === 'ok' ? dashboard.live.snapshot : dashboard.live.status === 'error' ? dashboard.live.snapshot : null;
	// A saved snapshot that failed to refresh is old: don't resolve or open live issues from it.
	const freshLive = dashboard.live.status === 'ok' ? live : null;
	if (!dashboard.ops && !freshLive) return;
	const rules = await loadRules();
	const now = Date.now();
	const run = findConditions(dashboard.ops, freshLive, rules, now);

	const rows = await prisma.leacoIssue.findMany({ where: { status: { not: 'RESOLVED' } } });
	const existing: StoredIssue[] = rows.map((r) => ({
		id: r.id,
		assetKey: r.assetKey,
		kind: r.kind,
		status: r.status as StoredIssue['status'],
		firstSeenAt: r.firstSeenAt,
		returnOn: r.returnOn ? r.returnOn.toISOString().slice(0, 10) : null
	}));
	const plan = planReconcile(existing, run, rules, now);
	const at = new Date(now);

	await prisma.$transaction([
		...plan.create.map((c) => prisma.leacoIssue.create({ data: { ...c, firstSeenAt: at, lastSeenAt: at } })),
		...plan.update.map(({ id, condition: c }) =>
			prisma.leacoIssue.update({ where: { id }, data: { assetName: c.assetName, property: c.property, detail: c.detail, source: c.source, lastSeenAt: at } })
		),
		...plan.reopen.map(({ id, condition: c }) =>
			prisma.leacoIssue.update({
				where: { id },
				data: { status: 'OPEN', archiveReason: null, returnOn: null, assetName: c.assetName, property: c.property, detail: c.detail, source: c.source, lastSeenAt: at }
			})
		),
		...(plan.resolve.length ? [prisma.leacoIssue.updateMany({ where: { id: { in: plan.resolve } }, data: { status: 'RESOLVED', resolvedAt: at } })] : []),
		...(plan.drop.length ? [prisma.leacoIssue.deleteMany({ where: { id: { in: plan.drop }, status: 'OPEN' } })] : []),
		...plan.reopen.map(({ id }) => prisma.auditEvent.create({ data: { action: 'issue_returned', resource: 'LeacoIssue', resourceId: id, metadata: { reason: 'return date reached' } } })),
		...plan.resolve.map((id) => prisma.auditEvent.create({ data: { action: 'issue_resolved', resource: 'LeacoIssue', resourceId: id, metadata: { reason: 'condition cleared' } } }))
	]);
}

export async function listIssues(): Promise<{ issues: IssueRow[]; rules: Rules }> {
	const rules = await loadRules();
	const now = Date.now();
	const since = new Date(now - 7 * 86_400_000);
	const rows = await prisma.leacoIssue.findMany({
		where: { OR: [{ status: { not: 'RESOLVED' } }, { resolvedAt: { gte: since } }] },
		orderBy: [{ firstSeenAt: 'asc' }]
	});
	const issues = rows.map((r) => ({
		id: r.id,
		assetKey: r.assetKey,
		kind: r.kind,
		status: r.status,
		assetName: r.assetName,
		property: r.property,
		detail: r.detail,
		source: r.source,
		firstSeenAt: r.firstSeenAt.toISOString(),
		lastSeenAt: r.lastSeenAt.toISOString(),
		resolvedAt: r.resolvedAt?.toISOString() ?? null,
		archiveReason: r.archiveReason,
		returnOn: r.returnOn ? r.returnOn.toISOString().slice(0, 10) : null,
		note: r.note,
		updatedAt: r.updatedAt.toISOString(),
		visible: isVisible(r, rules, now)
	}));
	// Resolved issues that never showed (cleared while waiting) don't belong in the list.
	return { issues: issues.filter((i) => i.visible || i.status !== 'OPEN'), rules };
}

// ---------- changes made by people (admins only; the routes check)

const idSchema = z.string().min(1).max(64);
const noteSchema = z.string().trim().max(500).optional().transform((v) => (v ? v : null));

export const ArchiveInput = z.object({
	id: idSchema,
	reason: z.enum(['NORMAL_FOR_WELL', 'NOT_URGENT', 'SCHEDULED', 'DATA_PROBLEM']),
	returnOn: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional()
		.or(z.literal('').transform(() => undefined)),
	note: noteSchema
});

export type ChangeResult = { ok: true } | { ok: false; message: string };

async function change(id: string, allowed: string[], actorId: string, action: string, data: Record<string, unknown>, metadata: Record<string, string>): Promise<ChangeResult> {
	const issue = await prisma.leacoIssue.findUnique({ where: { id } });
	if (!issue) return { ok: false, message: 'That issue no longer exists.' };
	if (!allowed.includes(issue.status)) return { ok: false, message: 'That issue has already changed. Reload to see its status.' };
	await prisma.$transaction([
		prisma.leacoIssue.update({ where: { id }, data }),
		prisma.auditEvent.create({ data: { actorId, action, resource: 'LeacoIssue', resourceId: id, metadata: { asset: issue.assetKey, kind: issue.kind, ...metadata } } })
	]);
	return { ok: true };
}

export function markContractorSent(id: string, actorId: string, note: string | null): Promise<ChangeResult> {
	return change(id, ['OPEN', 'ARCHIVED'], actorId, 'issue_contractor_sent', { status: 'CONTRACTOR_SENT', archiveReason: null, returnOn: null, ...(note ? { note } : {}) }, {});
}

export function archiveIssue(input: z.infer<typeof ArchiveInput>, actorId: string): Promise<ChangeResult> {
	return change(
		input.id,
		['OPEN', 'CONTRACTOR_SENT'],
		actorId,
		'issue_archived',
		{ status: 'ARCHIVED', archiveReason: input.reason, returnOn: input.returnOn ? new Date(`${input.returnOn}T00:00:00Z`) : null, note: input.note },
		{ reason: input.reason, ...(input.returnOn ? { returnOn: input.returnOn } : {}) }
	);
}

export function bringBack(id: string, actorId: string): Promise<ChangeResult> {
	return change(id, ['ARCHIVED', 'CONTRACTOR_SENT'], actorId, 'issue_brought_back', { status: 'OPEN', archiveReason: null, returnOn: null }, {});
}

// ---------- rules (admins only; the route checks)

export const RulesInput = z.object(
	Object.fromEntries(
		RULE_KEYS.map((k) => [
			k,
			z.object({
				enabled: z.boolean(),
				threshold: z.number().int().nullable(),
				option: z.string().max(20).nullable()
			})
		])
	) as Record<(typeof RULE_KEYS)[number], z.ZodObject<{ enabled: z.ZodBoolean; threshold: z.ZodNullable<z.ZodNumber>; option: z.ZodNullable<z.ZodString> }>>
);

export async function saveRules(input: z.infer<typeof RulesInput>, actorId: string): Promise<Rules> {
	const before = await loadRules();
	const next = mergeRules(RULE_KEYS.map((k) => ({ key: k, ...input[k] })));
	const changed = RULE_KEYS.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(next[k]));
	if (!changed.length) return before;
	await prisma.$transaction([
		...changed.map((k) =>
			prisma.leacoIssueRule.upsert({
				where: { key: k },
				create: { key: k, enabled: next[k].enabled, threshold: next[k].threshold, option: next[k].option },
				update: { enabled: next[k].enabled, threshold: next[k].threshold, option: next[k].option }
			})
		),
		...changed.map((k) =>
			prisma.auditEvent.create({
				data: {
					actorId,
					action: 'issue_rule_changed',
					resource: 'LeacoIssueRule',
					resourceId: k,
					metadata: { rule: RULE_DEFS[k].title, from: describe(before[k]), to: describe(next[k]) }
				}
			})
		)
	]);
	await refreshIssues(undefined, true);
	return next;
}

function describe(r: Rules[keyof Rules]): string {
	if (!r.enabled) return 'off';
	return [r.threshold !== null ? String(r.threshold) : null, r.option].filter(Boolean).join(' ') || 'on';
}

/** For the Overview: which (asset, kind) pairs people have set aside, and how many. */
export async function setAsideIssues(): Promise<{ keys: string[]; archived: number; contractorSent: number }> {
	const rows = await prisma.leacoIssue.findMany({ where: { status: { in: ['ARCHIVED', 'CONTRACTOR_SENT'] } }, select: { assetKey: true, kind: true, status: true } });
	return {
		keys: rows.map((r) => `${r.assetKey}|${r.kind}`),
		archived: rows.filter((r) => r.status === 'ARCHIVED').length,
		contractorSent: rows.filter((r) => r.status === 'CONTRACTOR_SENT').length
	};
}
