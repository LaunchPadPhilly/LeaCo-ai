import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dailyReportsFileSchema } from '../../src/lib/leaco/dailyReport';
import { buildHeadline } from '../../src/lib/leaco/headline';
import { RECONCILE_TOLERANCE_BBL, reconcile, sortByDate, summarize } from '../../src/lib/leaco/rules';

/**
 * Known-good figures from the brief (reference/PROMPT.md §4 rule 4), checked against the real
 * parsed Daily Reports. That file is LeaCo business data and is gitignored (PLAN D5), so this
 * suite skips where it's absent (CI included) and says so.
 */
const FILE = 'data/private/daily_parsed.json';
const present = existsSync(FILE);

describe.skipIf(!present)(`known-good figures (${FILE})`, () => {
	const reports = present
		? sortByDate(Object.values(dailyReportsFileSchema.parse(JSON.parse(readFileSync(FILE, 'utf8')))))
		: [];

	it('covers the 13 reports from Nov 7 to Nov 19, 2026', () => {
		expect(reports.map((r) => r.date)).toEqual(
			Array.from({ length: 13 }, (_, i) => `2026-11-${String(7 + i).padStart(2, '0')}`)
		);
	});

	it('all-reports water total is 344,557 bbl', () => {
		expect(summarize(reports, 'water').total).toBe(344_557);
	});

	it('7-day average is 26,684 bbl/day water and 52.4 bbl/day oil', () => {
		const last7 = reports.slice(-7);
		expect(Math.round(summarize(last7, 'water').average!)).toBe(26_684);
		expect(Math.round(summarize(last7, 'oil').average! * 10) / 10).toBe(52.4);
	});

	it(`every report reconciles within ${RECONCILE_TOLERANCE_BBL} bbl`, () => {
		const failures = reports.map(reconcile).filter((r) => r.status === 'mismatch' || r.status === 'no-data');
		expect(failures).toEqual([]);
	});

	it('headline KPI uses the header injector count', () => {
		const h = buildHeadline(reports)!;
		expect(h.asOf).toBe('2026-11-19');
		expect([h.injectors?.taking, h.injectors?.total]).toEqual([10, 29]);
		expect([h.wells?.running, h.wells?.total]).toEqual([42, 78]);
	});
});

if (!present) {
	describe('known-good figures', () => {
		it.skip(`skipped: ${FILE} not present (LeaCo data is not committed; see docs/leaco/PLAN.md D5)`, () => {});
	});
}
