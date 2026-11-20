import { describe, expect, it } from 'vitest';
import { appleDirectionsUrl, coordinates, googleDirectionsUrl, shareText } from '../../src/lib/leaco/ops/directions';

const inj = { name: 'East Eumont Unit 18 Injector', lat: 32.69172, lon: -103.25323, api: '30-025-05547', kind: 'injector' as const };

describe('directions links', () => {
	it('Google Maps directions use the documented key-free URL', () => {
		expect(googleDirectionsUrl(inj)).toBe('https://www.google.com/maps/dir/?api=1&destination=32.69172,-103.25323');
	});
	it('Apple Maps directions carry an encoded name', () => {
		expect(appleDirectionsUrl(inj)).toBe('https://maps.apple.com/?daddr=32.69172,-103.25323&q=East%20Eumont%20Unit%2018%20Injector');
	});
	it('coordinates keep 5 decimals (about 1 m)', () => {
		expect(coordinates({ lat: 32.1, lon: -103.2 })).toBe('32.10000, -103.20000');
	});
	it('the shared text says the location is approximate and to confirm the lease-road approach', () => {
		const t = shareText(inj);
		expect(t).toContain('API 30-025-05547');
		expect(t).toContain('approximate');
		expect(t).toContain('lease roads');
		expect(t).toContain(googleDirectionsUrl(inj));
		expect(t).toContain(appleDirectionsUrl(inj));
	});
	it('leaves out a missing API number instead of printing "null"', () => {
		expect(shareText({ ...inj, api: null })).not.toContain('null');
	});
});
