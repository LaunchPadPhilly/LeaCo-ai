import { describe, expect, it } from 'vitest';
import type { DailyReport } from '../../src/lib/leaco/dailyReport';
import { buildHeadline } from '../../src/lib/leaco/headline';
import { changeFrom, displayPct, reconcile, summarize } from '../../src/lib/leaco/rules';

const report = (over: Partial<DailyReport> = {}): DailyReport => ({
	date: '2026-11-19',
	water: 1000,
	oil: 50,
	inj_taking: [2, 3],
	wells_running: [4, 5],
	leases: { A: { water: 600, oil: 30 }, B: { water: 400, oil: 20 } },
	injectors: { 'MLMU-1': { name: 'MLMU #1', vol: 700 }, 'MLMU-2': { name: 'MLMU #2', vol: 250 } },
	other_injectors: { count: 4, vol: 50 },
	...over
});

describe('displayPct (brief §4 rule 6)', () => {
	it('never shows 100% unless it is exactly 100%', () => {
		expect(displayPct(999, 1000)).toBe(99);
		expect(displayPct(1000, 1000)).toBe(100);
	});
	it('rounds normally below 100', () => {
		expect(displayPct(42, 78)).toBe(54);
		expect(displayPct(1, 3)).toBe(33);
	});
	it('returns null for missing or empty totals, never 0', () => {
		expect(displayPct(null, 10)).toBeNull();
		expect(displayPct(3, null)).toBeNull();
		expect(displayPct(0, 0)).toBeNull();
	});
});

describe('reconcile (brief §4 rule 4)', () => {
	it('passes when both checks add up exactly', () => {
		expect(reconcile(report()).status).toBe('exact');
	});
	it('calls a gap within 3 bbl rounding', () => {
		const r = reconcile(report({ water: 1002 }));
		expect(r.status).toBe('rounding');
		expect(r.checks.map((c) => c.gap)).toEqual([-2, -2]);
	});
	it('fails a gap over 3 bbl', () => {
		const r = reconcile(report({ water: 1004 }));
		expect(r.status).toBe('mismatch');
	});
	it('fails when only the lease rows are off', () => {
		const r = reconcile(report({ leases: { A: { water: 600, oil: 30 } } }));
		expect(r.status).toBe('mismatch');
		expect(r.checks[1].gap).toBe(-400);
	});
	it('reports no-data instead of reconciling a missing total', () => {
		expect(reconcile(report({ water: null })).status).toBe('no-data');
	});
	it('counts "No data" injector rows so they are visible', () => {
		const r = reconcile(
			report({ injectors: { 'MLMU-1': { name: 'MLMU #1', vol: 950 }, 'MLMU-9': { name: 'MLMU #9', vol: null } } })
		);
		expect(r.injectorRowsWithoutVolume).toBe(1);
		expect(r.status).toBe('exact');
	});
});

describe('summarize and changeFrom (brief §4 rule 1: never invent data)', () => {
	it('averages only the days that reported, and says how many', () => {
		const s = summarize([report({ water: 100 }), report({ water: null }), report({ water: 300 })], 'water');
		expect(s).toEqual({ total: 400, average: 200, daysReported: 2, daysInPeriod: 3 });
	});
	it('gives no total when no day reported', () => {
		expect(summarize([report({ oil: null })], 'oil').total).toBeNull();
	});
	it('gives no change when either day is missing', () => {
		expect(changeFrom(10, null)).toBeNull();
		expect(changeFrom(null, 10)).toBeNull();
		expect(changeFrom(12, 10)).toEqual({ delta: 2, pct: 20 });
	});
});

describe('buildHeadline', () => {
	it('uses the report header for the injector KPI, and keeps the row count alongside (PLAN D4)', () => {
		const h = buildHeadline([report({ inj_taking: [5, 29] })]);
		expect(h?.injectors?.taking).toBe(5);
		expect(h?.injectors?.rowsTaking).toBe(2);
	});
	it('compares against the prior report by date, whatever the input order', () => {
		const h = buildHeadline([
			report({ date: '2026-11-19', water: 1000 }),
			report({ date: '2026-11-18', water: 800 })
		]);
		expect(h?.asOf).toBe('2026-11-19');
		expect(h?.water.change?.delta).toBe(200);
	});
	it('returns null with no reports', () => {
		expect(buildHeadline([])).toBeNull();
	});
});
