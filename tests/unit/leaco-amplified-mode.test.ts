import { describe, expect, it } from 'vitest';
import reference from '../../src/lib/leaco/reference/wells.json' with { type: 'json' };
import layers from '../../src/lib/leaco/reference/layers.json' with { type: 'json' };
import { opsFromAmplified, referenceNotInAmplified } from '../../src/lib/leaco/ops/fromAmplified';
import type { LiveSnapshot, LiveWell } from '../../src/lib/leaco/ops/live';
import { injectorPeriod, wellStatus } from '../../src/lib/leaco/ops/status';
import { areaSummary } from '../../src/lib/leaco/ops/summary';

const well = (over: Partial<LiveWell>): LiveWell => ({
	key: 'EEU-21',
	customerAssetId: 'East_Eumont_Unit_21',
	amplifiedId: 4757,
	name: 'East Eumont Unit 21',
	leaseName: 'East Eumont Unit',
	link: 'confirmed',
	linkNote: null,
	status: 'Running',
	runtimeYesterday: 46,
	tubingPressure: 72.8,
	casingPressure: null,
	lastConnection: '2026-11-23 20:00:00',
	tickets: [],
	...over
});

const days = (n: number, oil: number | null, water: number | null) =>
	Array.from({ length: n }, (_, i) => ({ day: new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10), oil, water }));

const snapshot = (): LiveSnapshot => ({
	syncedAt: '2026-11-23T20:17:00Z',
	wells: {
		'EEU-21': well({}),
		'EEU-18': well({ key: 'EEU-18', customerAssetId: 'East_Eumont_Unit_18', name: 'East Eumont Unit 18', link: 'probable', linkNote: 'Amplified names it a well; LeaCo list says injector', status: null }),
		'AMP-Myers_Langlie_Mattix_Unit_Battery': well({
			key: 'AMP-Myers_Langlie_Mattix_Unit_Battery',
			customerAssetId: 'Myers_Langlie_Mattix_Unit_Battery',
			name: 'Myers Langlie Mattix Unit Battery',
			leaseName: 'Myers Langlie Mattix Unit',
			link: null,
			status: 'Idle'
		})
	},
	leases: [
		{ customerAssetId: 'East_Eumont_Unit', name: 'East Eumont Unit', area: 'eeu', days: days(40, 10, 90) },
		{ customerAssetId: 'Myers_Langlie_Mattix_Unit', name: 'Myers Langlie Mattix Unit', area: 'mlmu', days: days(40, 20, null) }
	],
	notLinked: { 'WHRB-20': 'ID says #24 but name says #20', 'MLMU-204': 'No Amplified asset has an ID for this well yet.' },
	warnings: []
});

describe('dashboard data from Amplified (owner rule: API first, fill from public records, else missing)', () => {
	const ops = opsFromAmplified(snapshot());

	it('uses the last 30 complete ledger days and sums oil and produced water across leases', () => {
		expect(ops.mode).toBe('amplified');
		expect(ops.dates).toHaveLength(30);
		expect(ops.totals.at(-1)).toMatchObject({ oil: 30, producedWater: 90 });
	});
	it('never fills what Amplified lacks: water injected, injector counts, wells-running history', () => {
		for (const t of ops.totals) {
			expect(t.water).toBeNull();
			expect(t.injectorsTaking).toBeNull();
			expect(t.wellsRunning).toBeNull();
		}
	});
	it('30-day oil only when the ledger reaches back the full 30 days', () => {
		expect(ops.areas.eeu.at(-1)!.oil30).toBe(300);
		expect(ops.areas.rw.at(-1)!.oil30).toBeNull(); // no RW lease in this snapshot
	});
	it('fills location, API and kind from the public record for linked wells', () => {
		const eeu21 = ops.assets.find((a) => a.key === 'EEU-21')!;
		const ref = reference.wells.find((w) => w.key === 'EEU-21')!;
		expect([eeu21.lat, eeu21.lon, eeu21.api]).toEqual([ref.lat, ref.lon, ref.api]);
		expect(ops.assets.find((a) => a.key === 'EEU-18')!.kind).toBe('injector'); // probable link: state record says injector
	});
	it('leaves an Amplified-only asset without a location (listed, not mapped) and says why', () => {
		const battery = ops.assets.find((a) => a.key === 'AMP-Myers_Langlie_Mattix_Unit_Battery')!;
		expect([battery.lat, battery.lon, battery.api]).toEqual([null, null, null]);
		expect(battery.area).toBe('mlmu');
		expect(battery.idNote).toMatch(/missing/);
	});
	it('status is Amplified’s current reading; injectors are "no data" (no injection in Amplified)', () => {
		const p = { s: 29, e: 29 };
		expect(wellStatus(ops.assets.find((a) => a.key === 'EEU-21')!, p)).toBe('run');
		expect(wellStatus(ops.assets.find((a) => a.key === 'AMP-Myers_Langlie_Mattix_Unit_Battery')!, p)).toBe('idle');
		expect(injectorPeriod(ops.assets.find((a) => a.key === 'EEU-18')!, p).status).toBe('nodata');
		expect(areaSummary(ops, 'mlmu', p).wells.idle).toBe(1);
	});
	it('lists state-record wells Amplified has no usable link for', () => {
		expect(referenceNotInAmplified(snapshot()).map((w) => w.key).sort()).toEqual(['MLMU-204', 'WHRB-20']);
	});
	it('copes with an empty ledger without inventing a value', () => {
		const empty = opsFromAmplified({ ...snapshot(), leases: [] });
		expect(empty.dates).toEqual(['2026-11-23']);
		expect(empty.totals[0].oil).toBeNull();
	});
});

describe('committed public reference data', () => {
	const PUBLIC_FIELDS = ['key', 'name', 'kind', 'area', 'lat', 'lon', 'api', 'stateName', 'operator', 'landType', 'amplified'];
	it('wells carry only public state-record fields plus the Amplified link', () => {
		for (const w of reference.wells) expect(Object.keys(w).sort()).toEqual([...PUBLIC_FIELDS].sort());
	});
	it('contains no report volumes, notes, prices or LeaCo map-file data', () => {
		const text = JSON.stringify(reference) + JSON.stringify(layers);
		expect(text).not.toMatch(/pumper|"hist"|"ds"|"rt7"|id_note|0\.265|\$0\.13|"water"|"oil"/i);
		expect(layers).not.toHaveProperty('winkler');
	});
	it('every Amplified link has a status, and only "probable" or "conflict" links carry a note', () => {
		for (const w of reference.wells) {
			if (!w.amplified) continue;
			expect(['confirmed', 'probable', 'conflict']).toContain(w.amplified.status);
			expect(w.amplified.status === 'confirmed' ? w.amplified.note : 'n/a').not.toBe(undefined);
			if (w.amplified.status === 'confirmed') expect(w.amplified.note).toBeNull();
		}
	});
});
