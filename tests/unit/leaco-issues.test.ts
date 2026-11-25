import { describe, expect, it } from 'vitest';
import { findConditions, isVisible } from '../../src/lib/leaco/issues/conditions';
import { planReconcile, type StoredIssue } from '../../src/lib/leaco/issues/reconcile';
import { defaultRules, mergeRules, priorityCounts } from '../../src/lib/leaco/issues/rules';
import { opsFromAmplified } from '../../src/lib/leaco/ops/fromAmplified';
import type { LiveSnapshot, LiveWell } from '../../src/lib/leaco/ops/live';

const NOW = Date.parse('2026-11-25T15:00:00Z');
const HOUR = 3_600_000;

const well = (over: Partial<LiveWell>): LiveWell => ({
	key: 'EEU-21',
	customerAssetId: 'East_Eumont_Unit_21',
	amplifiedId: 1,
	name: 'East Eumont Unit 21',
	leaseName: 'East Eumont Unit',
	link: 'confirmed',
	linkNote: null,
	status: 'Running',
	runtimeYesterday: 40,
	tubingPressure: null,
	casingPressure: null,
	lastConnection: '2026-11-25 14:00:00',
	tickets: [],
	...over
});
const ticket = (priority: string | null) => ({ id: 1, title: 'High casing pressure', type: null, priority, status: 'Open', created: null, assetName: null });
const days = (n: number) => Array.from({ length: n }, (_, i) => ({ day: new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10), oil: 10, water: 90 }));
const snap = (wells: LiveWell[]): LiveSnapshot => ({
	syncedAt: '2026-11-25T14:50:00Z',
	wells: Object.fromEntries(wells.map((w) => [w.key, w])),
	leases: [{ customerAssetId: 'East_Eumont_Unit', name: 'East Eumont Unit', area: 'eeu', days: days(40) }],
	notLinked: {},
	warnings: []
});
const run = (wells: LiveWell[], rules = defaultRules()) => {
	const s = snap(wells);
	return findConditions(opsFromAmplified(s), s, rules, NOW);
};

describe('issue rules', () => {
	it('defaults: idle 24 h, offline 24 h, water drop 20 %, late report off', () => {
		const r = defaultRules();
		expect([r.well_idle.threshold, r.device_offline.threshold, r.water_drop.threshold, r.report_late.enabled]).toEqual([24, 24, 20, false]);
	});
	it('saved rows override defaults, out-of-range numbers are clamped, unknown keys ignored', () => {
		const r = mergeRules([
			{ key: 'well_idle', enabled: true, threshold: 9999, option: null },
			{ key: 'nope', enabled: false, threshold: 1, option: null }
		]);
		expect(r.well_idle.threshold).toBe(336);
		expect(Object.keys(r)).not.toContain('nope');
	});
	it('ticket priorities: P1 only, P1 and P2, or any (unknown priority counts only under any)', () => {
		expect(priorityCounts('P2', 'p1')).toBe(false);
		expect(priorityCounts('Priority 2', 'p1_p2')).toBe(true);
		expect(priorityCounts(null, 'p1_p2')).toBe(false);
		expect(priorityCounts(null, 'any')).toBe(true);
	});
});

describe('conditions from the data', () => {
	it('one condition per asset and kind: a shut-down well with a ticket is two', () => {
		const { conditions } = run([well({ status: 'Shutdown', tickets: [ticket('P2')] })]);
		expect(conditions.map((c) => c.kind).sort()).toEqual(['SHUTDOWN', 'TICKET']);
	});
	it('a rule switched off opens nothing', () => {
		const rules = defaultRules();
		rules.well_idle.enabled = false;
		expect(run([well({ status: 'Idle' })], rules).conditions).toEqual([]);
	});
	it('offline uses the rule’s hours', () => {
		const rules = defaultRules();
		rules.device_offline.threshold = 2;
		const { conditions } = run([well({ lastConnection: '2026-11-25 10:00:00' })], rules);
		expect(conditions).toMatchObject([{ kind: 'OFFLINE' }]);
	});
	it('without a live snapshot, live kinds are not observed (so they are never resolved by mistake)', () => {
		const s = snap([well({})]);
		const { observed } = findConditions(opsFromAmplified(s), null, defaultRules(), NOW);
		expect(observed).not.toContain('OFFLINE');
		expect(observed).not.toContain('TICKET');
	});
	it('idle waits for its rule before it shows', () => {
		const rules = defaultRules();
		expect(isVisible({ kind: 'IDLE', firstSeenAt: new Date(NOW - 3 * HOUR) }, rules, NOW)).toBe(false);
		expect(isVisible({ kind: 'IDLE', firstSeenAt: new Date(NOW - 25 * HOUR) }, rules, NOW)).toBe(true);
		expect(isVisible({ kind: 'SHUTDOWN', firstSeenAt: new Date(NOW) }, rules, NOW)).toBe(true);
	});
});

describe('reconcile plan', () => {
	const stored = (over: Partial<StoredIssue>): StoredIssue => ({ id: 'i1', assetKey: 'EEU-21', kind: 'SHUTDOWN', status: 'OPEN', firstSeenAt: new Date(NOW - 48 * HOUR), returnOn: null, ...over });
	const rules = defaultRules();

	it('opens new conditions and refreshes ones already stored', () => {
		const r = run([well({ status: 'Shutdown' }), well({ key: 'EEU-3', customerAssetId: 'East_Eumont_Unit_3', name: 'East Eumont Unit 3', status: 'Shutdown' })]);
		const plan = planReconcile([stored({})], r, rules, NOW);
		expect(plan.create.map((c) => c.assetKey)).toEqual(['EEU-3']);
		expect(plan.update.map((u) => u.id)).toEqual(['i1']);
	});
	it('keeps people’s decisions: an archived issue stays archived while the condition lasts', () => {
		const plan = planReconcile([stored({ status: 'ARCHIVED', returnOn: '2026-12-02' })], run([well({ status: 'Shutdown' })]), rules, NOW);
		expect(plan.update).toHaveLength(1);
		expect(plan.reopen).toHaveLength(0);
	});
	it('an archived issue returns on its return date', () => {
		const plan = planReconcile([stored({ status: 'ARCHIVED', returnOn: '2026-11-25' })], run([well({ status: 'Shutdown' })]), rules, NOW);
		expect(plan.reopen.map((r) => r.id)).toEqual(['i1']);
	});
	it('resolves cleared issues, including contractor-sent ones', () => {
		const plan = planReconcile([stored({ status: 'CONTRACTOR_SENT' })], run([well({})]), rules, NOW);
		expect(plan.resolve).toEqual(['i1']);
	});
	it('leaves issues alone when their source wasn’t read this time', () => {
		const s = snap([well({})]);
		const noLive = findConditions(opsFromAmplified(s), null, rules, NOW);
		const plan = planReconcile([stored({ kind: 'TICKET' })], noLive, rules, NOW);
		expect(plan.resolve).toEqual([]);
	});
	it('drops an idle issue that cleared before anyone could see it', () => {
		const plan = planReconcile([stored({ kind: 'IDLE', firstSeenAt: new Date(NOW - 2 * HOUR) })], run([well({})]), rules, NOW);
		expect(plan.drop).toEqual(['i1']);
		expect(plan.resolve).toEqual([]);
	});
});
