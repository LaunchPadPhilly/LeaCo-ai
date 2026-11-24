import { describe, expect, it } from 'vitest';
import type { DailyReport } from '../../src/lib/leaco/dailyReport';
import { opsFromAmplified } from '../../src/lib/leaco/ops/fromAmplified';
import type { LiveSnapshot } from '../../src/lib/leaco/ops/live';
import { assetMentions, parseReportText, reportDateFromName } from '../../src/lib/leaco/reportText';

// Made-up figures, laid out the way the document source stores a report PDF: pdf.js text with
// every run of spaces collapsed to one (src/lib/server/documents/extract.ts cleanText).
const PAGE_1 = `LeaCo Daily Report
Water injected (bbl/day) 12,480
Oil produced (bbl/day) 141.6
Own produced water (bbl/day) 2,310
Third-party water: 10,170 bbl
Injectors taking water: 18 / 26
Wells running: 41 / 57
Lease Yesterday 30-day Yesterday 30-day Yesterday 30-day
MLMU 12,100 350,000 80.2 2,400 1,900 55,000
East Eumont 0 0 55.1 1,650 300 9,000
Rhodes Yates 380 11,000 6.3 190 110 3,300
Total 12,480 361,000 141.6 4,240 2,310 67,300`;

const PAGE_2 = `Injector (bbl) Yesterday Prior day Pressure Yesterday Prior day Notes
MLMU #141 4,200 4,050 steady 1,210 1,190 ok
MLMU #204 No Data 3,900 gauge 1,100 1,080 check
East Eumont #18 0 0 shut in No Data No Data
All other injectors (22) 8,280
Total injected 12,480`;

describe('reading a daily report from its stored text', () => {
	const result = parseReportText([PAGE_1, PAGE_2], '2026-11-18');
	const report = result.ok ? result.report : null;

	it('reads the labelled header figures', () => {
		expect(result.ok).toBe(true);
		expect(report).toMatchObject({
			date: '2026-11-18',
			water: 12480,
			oil: 141.6,
			own_water: 2310,
			third_party: 10170,
			inj_taking: [18, 26],
			wells_running: [41, 57],
			other_injectors: { count: 22, vol: 8280 }
		});
	});
	it('reads lease rows up to the total, and stops there', () => {
		expect(Object.keys(report!.leases)).toEqual(['MLMU', 'East Eumont', 'Rhodes Yates']);
		expect(report!.leases.MLMU).toMatchObject({ water: 12100, oil: 80.2 });
	});
	it('reads injector rows by asset key, with "No Data" as null, never 0', () => {
		expect(report!.injectors['MLMU-141']).toMatchObject({ vol: 4200 });
		expect(report!.injectors['MLMU-204'].vol).toBeNull();
		expect(report!.injectors['EEU-18'].vol).toBe(0);
	});
	it('gives null for a figure the report does not state', () => {
		const r = parseReportText(['Water injected (bbl/day) No Data\nWells running: 40 / 57'], '2026-11-19');
		expect(r.ok && r.report.water).toBeNull();
		expect(r.ok && r.report.oil).toBeNull();
	});
	it('refuses text that has none of the header figures', () => {
		expect(parseReportText(['Lease agreement between LeaCo and a counterparty'], '2026-11-19').ok).toBe(false);
	});
});

describe('report dates from file names', () => {
	it('reads ISO names as they are', () => {
		expect(reportDateFromName('2026-11-20.pdf', null)).toBe('2026-11-20');
	});
	it('takes the year from when the file was written', () => {
		expect(reportDateFromName('LeaCo_Daily_Report_Nov18.pdf', new Date('2026-11-18T14:00:00Z'))).toBe('2026-11-18');
	});
	it('steps back a year for a late-December report saved in January', () => {
		expect(reportDateFromName('LeaCo Daily Report Dec31.pdf', new Date('2027-01-01T09:00:00Z'))).toBe('2026-12-31');
	});
	it('gives null without a date', () => {
		expect(reportDateFromName('Oncor easement.pdf', new Date())).toBeNull();
		expect(reportDateFromName('LeaCo_Daily_Report_Feb30.pdf', new Date('2027-03-01T00:00:00Z'))).toBeNull();
	});
});

describe('asset mentions', () => {
	it('carries a lease prefix to following bare numbers', () => {
		expect(assetMentions('MLMU #141 and #142, then East Eumont #18')).toEqual(['MLMU-141', 'MLMU-142', 'EEU-18']);
	});
});

describe('Amplified mode with Dropbox reports', () => {
	const days = (n: number) => Array.from({ length: n }, (_, i) => ({ day: new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10), oil: 10, water: 50 }));
	const snapshot: LiveSnapshot = {
		syncedAt: '2026-11-24T16:00:00Z',
		wells: {},
		leases: [{ customerAssetId: 'Myers_Langlie_Mattix_Unit', name: 'Myers Langlie Mattix Unit', area: 'mlmu', days: days(23) }],
		notLinked: {},
		warnings: []
	};
	const report = (parseReportText([PAGE_1, PAGE_2], '2026-11-18') as { ok: true; report: DailyReport }).report;
	const ops = opsFromAmplified(snapshot, [report, { ...report, date: '2026-10-01' }]);
	const i = ops.dates.indexOf('2026-11-18');

	it('fills water injected and the header counts on the report day only', () => {
		expect(ops.totals[i]).toMatchObject({ water: 12480, injectorsTaking: [18, 26], wellsRunning: [41, 57], oil: 10 });
		expect(ops.totals[i - 1]).toMatchObject({ water: null, injectorsTaking: null, wellsRunning: null });
	});
	it('splits water injected by area from the lease rows', () => {
		expect(ops.areas.mlmu[i].water).toBe(12100);
		expect(ops.areas.eeu[i].water).toBe(0);
		expect(ops.areas.rw[i].water).toBe(380);
		expect(ops.areas.mlmu[i - 1].water).toBeNull();
	});
	it('ignores reports outside the shown days and records the reconciliation', () => {
		expect(ops.dates).not.toContain('2026-10-01');
		expect(Object.keys(ops.reconciliation)).toEqual(['2026-11-18']);
		expect(ops.reconciliation['2026-11-18']).toBe('exact');
		expect(ops.source).toMatch(/Daily Reports from Dropbox/);
	});
	it('is unchanged without reports', () => {
		const plain = opsFromAmplified(snapshot);
		expect(plain.totals.every((t) => t.water === null && t.wellsRunning === null)).toBe(true);
		expect(plain.reconciliation).toEqual({});
	});
});
