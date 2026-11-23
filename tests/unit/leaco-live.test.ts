import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { agoText, isOffline, leaseArea, parseAmplifiedTime } from '../../src/lib/leaco/ops/live';
import type { LiveSnapshot } from '../../src/lib/leaco/ops/live';

const NOW = Date.parse('2026-11-20T21:15:00Z');

describe('live helpers', () => {
	it('reads Amplified timestamps as UTC', () => {
		expect(parseAmplifiedTime('2026-11-20 21:10:05')).toBe(Date.parse('2026-11-20T21:10:05Z'));
		expect(parseAmplifiedTime(null)).toBeNull();
		expect(parseAmplifiedTime('not a time')).toBeNull();
	});
	it('treats a device silent for over a day, or never seen, as offline', () => {
		expect(isOffline({ lastConnection: '2026-11-20 21:10:05' }, NOW)).toBe(false);
		expect(isOffline({ lastConnection: '2026-10-26 02:35:00' }, NOW)).toBe(true);
		expect(isOffline({ lastConnection: null }, NOW)).toBe(true);
	});
	it('maps leases to areas', () => {
		expect(leaseArea('Myers_Langlie_Mattix_Unit')).toBe('mlmu');
		expect(leaseArea('East_Eumont_Unit')).toBe('eeu');
		expect(leaseArea('Mary_E_Wills_A_Federal')).toBe('rw');
	});
	it('says how old the sync is in words', () => {
		expect(agoText('2026-11-20T21:14:40Z', NOW)).toBe('just now');
		expect(agoText('2026-11-20T21:03:00Z', NOW)).toBe('12 min ago');
		expect(agoText('2026-11-20T18:15:00Z', NOW)).toBe('3 h ago');
	});
});

const SNAP = 'data/private/amplified/live.json';
describe.skipIf(!existsSync(SNAP))(`saved Amplified snapshot (${SNAP})`, () => {
	const s = existsSync(SNAP) ? (JSON.parse(readFileSync(SNAP, 'utf8')) as LiveSnapshot) : null;
	it('links only confirmed wells, and says why the others are not linked', () => {
		expect(Object.keys(s!.wells).length).toBeGreaterThan(80);
		// The two cases still awaiting LeaCo: an ID/name conflict, and an injector Amplified labels as a well.
		expect(s!.wells['WHRB-20']).toBeUndefined();
		expect(s!.notLinked['WHRB-20']).toMatch(/#24/);
		expect(s!.wells['EEU-18']).toBeUndefined();
		expect(s!.notLinked['EEU-18']).toMatch(/injector/);
	});
	it('stores missing values as null, never zero, and leaves out the unfinished day', () => {
		for (const w of Object.values(s!.wells)) {
			for (const v of [w.runtimeYesterday, w.tubingPressure, w.casingPressure]) expect(v === null || typeof v === 'number').toBe(true);
		}
		const today = s!.syncedAt.slice(0, 10);
		expect(s!.leases.flatMap((l) => l.days).every((d) => d.day < today)).toBe(true);
	});
});
