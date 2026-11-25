import { describe, expect, it } from 'vitest';
import { opsFromAmplified } from '../../src/lib/leaco/ops/fromAmplified';
import type { LiveSnapshot, LiveWell } from '../../src/lib/leaco/ops/live';
import { needsContractor, needsSummary } from '../../src/lib/leaco/ops/needs';
import { presetPeriod } from '../../src/lib/leaco/ops/period';

const NOW = Date.parse('2026-11-25T15:00:00Z');

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
	tubingPressure: null,
	casingPressure: null,
	lastConnection: '2026-11-25 14:00:00',
	tickets: [],
	...over
});

const days = (n: number) =>
	Array.from({ length: n }, (_, i) => ({ day: new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10), oil: 10, water: 90 }));

const snapshot = (wells: LiveWell[]): LiveSnapshot => ({
	syncedAt: '2026-11-25T14:50:00Z',
	wells: Object.fromEntries(wells.map((w) => [w.key, w])),
	leases: [{ customerAssetId: 'East_Eumont_Unit', name: 'East Eumont Unit', area: 'eeu', days: days(40) }],
	notLinked: {},
	warnings: []
});

const run = (snap: LiveSnapshot) => {
	const ops = opsFromAmplified(snap);
	return needsContractor(ops, presetPeriod('day', ops.dates.length), snap, NOW, () => 'Nov 24');
};

describe('Needs a contractor (Overview)', () => {
	it('lists a live shutdown once, with its runtime and source', () => {
		const items = run(snapshot([well({ status: 'Shutdown', runtimeYesterday: 12 }), well({ key: 'EEU-3', customerAssetId: 'East_Eumont_Unit_3', name: 'East Eumont Unit 3' })]));
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ key: 'EEU-21', kind: 'shutdown', state: 'Shut down', source: 'Amplified' });
	});

	it('flags a shut-down well whose device stopped checking in as offline, not as a fresh shutdown', () => {
		const [item] = run(snapshot([well({ status: 'Shutdown', lastConnection: '2026-11-22 10:00:00' })]));
		expect(item.kind).toBe('offline');
		expect(item.detail).toMatch(/status may be out of date/);
	});

	it('folds an open ticket into the same row instead of listing the well twice', () => {
		const items = run(snapshot([well({ status: 'Shutdown', tickets: [{ id: 1, title: 'High casing pressure', type: null, priority: 'P2', status: 'Open', created: null, assetName: null }] })]));
		expect(items).toHaveLength(1);
		expect(items[0].detail).toMatch(/ticket: High casing pressure · P2/);
	});

	it('lists a running well with an open ticket as a ticket', () => {
		const items = run(snapshot([well({ tickets: [{ id: 2, title: 'Belt fraying', type: null, priority: null, status: 'Open', created: null, assetName: null }] })]));
		expect(items[0]).toMatchObject({ kind: 'ticket', state: 'Open ticket', detail: 'Belt fraying' });
	});

	it('is empty when nothing needs a visit, and the summary counts each row once', () => {
		expect(run(snapshot([well({})]))).toEqual([]);
		const items = run(snapshot([well({ status: 'Shutdown' }), well({ key: 'EEU-3', customerAssetId: 'East_Eumont_Unit_3', name: 'East Eumont Unit 3', status: 'Shutdown' })]));
		expect(needsSummary(items)).toBe('2 wells down');
	});
});
