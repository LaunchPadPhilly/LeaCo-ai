import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clampPeriod, periodLabel, presetOf, presetPeriod, sumReported } from '../../src/lib/leaco/ops/period';
import { injectorPeriod, wellStatus } from '../../src/lib/leaco/ops/status';
import { areaSummary, headline } from '../../src/lib/leaco/ops/summary';
import type { AssetDay, OpsAsset } from '../../src/lib/leaco/ops/types';
import { loadOpsData } from '../../src/lib/server/leaco/opsData';

const day = (over: Partial<AssetDay> = {}): AssetDay => ({
	status: null,
	volume: null,
	pressure: null,
	volumeSource: 'absent',
	groupedSmall: false,
	runtime: null,
	notes: [],
	...over
});

const asset = (kind: OpsAsset['kind'], days: AssetDay[]): OpsAsset => ({
	key: 'X-1',
	name: 'X 1',
	kind,
	area: 'mlmu',
	lon: 0,
	lat: 0,
	api: null,
	stateName: null,
	operator: null,
	landType: null,
	amplifiedId: null,
	customerId: null,
	idNote: null,
	pumperNote: null,
	snapshotDate: null,
	runtimeLatest: null,
	runtime7: null,
	runtime13: null,
	controlMode: null,
	days
});

describe('period', () => {
	it('builds and recognises the presets', () => {
		expect(presetPeriod('day', 13)).toEqual({ s: 12, e: 12 });
		expect(presetPeriod('7', 13)).toEqual({ s: 6, e: 12 });
		expect(presetPeriod('7', 3)).toEqual({ s: 0, e: 2 });
		expect(presetOf({ s: 0, e: 12 }, 13)).toBe('all');
		expect(presetOf({ s: 3, e: 9 }, 13)).toBeNull();
	});
	it('clamps out-of-range and inverted periods', () => {
		expect(clampPeriod({ s: 9, e: 4 }, 13)).toEqual({ s: 4, e: 4 });
		expect(clampPeriod({ s: -2, e: 40 }, 13)).toEqual({ s: 0, e: 12 });
	});
	it('labels days without timezone drift', () => {
		expect(periodLabel(['2026-11-07', '2026-11-19'], { s: 0, e: 1 })).toBe('Nov 7–Nov 19');
	});
	it('sums only reported days', () => {
		expect(sumReported([1, null, 3], { s: 0, e: 2 })).toEqual({ total: 4, reported: 2 });
		expect(sumReported([null, null], { s: 0, e: 1 })).toEqual({ total: null, reported: 0 });
	});
});

describe('status for a period', () => {
	it('an injector that took water on any day in the period counts as taking water', () => {
		const a = asset('injector', [
			day({ status: 'idle' }),
			day({ status: 'take', volume: 120, volumeSource: 'reading' }),
			day({ status: 'stuck', volume: 0, volumeSource: 'reading' })
		]);
		expect(injectorPeriod(a, { s: 0, e: 2 })).toEqual({ status: 'take', volume: 120, daysTaking: 1 });
		expect(injectorPeriod(a, { s: 2, e: 2 }).status).toBe('stuck');
	});
	it('a missing injector code is "no data", not idle', () => {
		expect(injectorPeriod(asset('injector', [day()]), { s: 0, e: 0 })).toEqual({ status: 'nodata', volume: null, daysTaking: 0 });
	});
	it('grouped or missing volumes are not summed as readings', () => {
		const a = asset('injector', [day({ status: 'idle', volumeSource: 'grouped' }), day({ status: 'idle', volumeSource: 'no-reading' })]);
		expect(injectorPeriod(a, { s: 0, e: 1 }).volume).toBeNull();
	});
	it('a well with no code for the day is "not mentioned"', () => {
		expect(wellStatus(asset('well', [day({ status: 'run' }), day()]), { s: 1, e: 1 })).toBe('unk');
	});
});

const present = existsSync('data/private/combined_data.json');

describe.skipIf(!present)('loadOpsData (data/private)', () => {
	it('loads 104 assets aligned to 13 report days, with the brief’s figures', async () => {
		const r = await loadOpsData();
		if (r.status !== 'ok') throw new Error(`expected ok, got ${r.status}`);
		const d = r.data;
		expect(d.dates).toHaveLength(13);
		expect(d.assets).toHaveLength(104);
		expect(d.assets.every((a) => a.days.length === 13)).toBe(true);

		const all = headline(d, presetPeriod('all', 13));
		expect(all.water.value).toBe(344_557);
		const week = headline(d, presetPeriod('7', 13));
		expect(Math.round(week.water.perDay!)).toBe(26_684);
		expect(Math.round(week.oil.perDay! * 10) / 10).toBe(52.4);

		const latest = headline(d, presetPeriod('day', 13));
		expect(latest.injectors).toEqual([10, 29]);
		expect(latest.wells).toEqual([42, 78]);
		expect(latest.water.change).toBe(29_030 - 20_001);
	});

	it('MLMU takes nearly all the water but never shows 100%', async () => {
		const r = await loadOpsData();
		if (r.status !== 'ok') throw new Error(r.status);
		const s = areaSummary(r.data, 'mlmu', presetPeriod('all', 13));
		expect(s.waterShare).toBeGreaterThanOrEqual(95);
		expect(s.waterShare).toBeLessThanOrEqual(99);
	});

	it('has the Winkler and Crawford boundaries, the state line, and reconciliation per day', async () => {
		const r = await loadOpsData();
		if (r.status !== 'ok') throw new Error(r.status);
		expect(r.data.winklerBoundary.length).toBeGreaterThan(0);
		expect(r.data.crawford.length).toBeGreaterThan(0);
		expect(r.data.stateLine.length).toBeGreaterThan(0);
		expect(Object.keys(r.data.reconciliation)).toHaveLength(13);
		expect(Object.values(r.data.reconciliation)).not.toContain('mismatch');
	});
});
