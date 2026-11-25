import { dailyReportSchema, type DailyReport } from './dailyReport';

/**
 * Reads one "LeaCo Daily Report" PDF from the text the Dropbox document source stored for it
 * (src/lib/server/documents/extract.ts: pdf.js text per page, runs of spaces collapsed to one).
 * A TypeScript port of the label rules in reference/reference_scripts/parse_daily.py, which
 * read `pdftotext -layout` output instead. Because column spacing is gone here, rows are read
 * by their order of values, not their position.
 *
 * Every value is taken from a labelled line in the report. A label that isn't found, or reads
 * "No Data", gives null; nothing is estimated or defaulted to 0.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * The report's date from its file name: "2026-11-18.pdf", or "LeaCo_Daily_Report_Nov18.pdf".
 * The second form carries no year, so the year is the one the file was last modified in, stepped back a year if that would
 * put the report after the file was written (a Dec 31 report saved on Jan 1).
 */
export function reportDateFromName(name: string, modifiedAt: Date | null): string | null {
	const iso = /\b(20\d\d)-(\d\d)-(\d\d)\b/.exec(name);
	if (iso) {
		const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
		return date.toISOString().slice(0, 10) === iso[0] ? iso[0] : null;
	}
	const m = /daily[ _-]?report.*?(?<![a-z])(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[ _-]?(\d{1,2})\b/i.exec(name);
	if (!m || !modifiedAt) return null;
	const month = MONTHS.indexOf(m[1].toLowerCase());
	const day = Number(m[2]);
	let year = modifiedAt.getUTCFullYear();
	if (Date.UTC(year, month, day) > modifiedAt.getTime()) year -= 1;
	const date = new Date(Date.UTC(year, month, day));
	if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
	return date.toISOString().slice(0, 10);
}

const NUM = String.raw`(No Data|n\/a|[\d,]+(?:\.\d+)?)`;

function num(s: string | undefined | null): number | null {
	if (s === undefined || s === null || s === '' || /^(no data|n\/a)$/i.test(s)) return null;
	const n = Number(s.replace(/,/g, ''));
	return Number.isFinite(n) ? n : null;
}

function labelled(text: string, pattern: string): number | null {
	return num(new RegExp(pattern, 'i').exec(text)?.[1]);
}

function pair(text: string, label: string): [number, number] | null {
	const m = new RegExp(`${label}:?\\s*(\\d+)\\s*\\/\\s*(\\d+)`, 'i').exec(text);
	return m ? [Number(m[1]), Number(m[2])] : null;
}

// Prefixes the reports use → the lease prefix in asset keys (same table as parse_daily.py).
const PREFIX: [string, string][] = [
	['MLMU', 'MLMU'],
	['Myers Langlie Mattix(?: Unit)?', 'MLMU'],
	['East Eumont(?: Unit)?', 'EEU'],
	['W ?H Rhodes B Fed(?:eral)? NCT-?1', 'WHRB'],
	['WH Rhodes A Fed(?:eral)?', 'WHRA'],
	['Rhodes Yates COOP Fed Com (\\d)', 'RYCF'],
	['Rhodes NCT COOP Fed\\.? Com 1', 'RNCF1'],
	['Rhodes Yates(?: Unit)?', 'RYU'],
	['Mary E Wills A Federal', 'MEWAF'],
	['Mr Wills Federal', 'MRWF'],
	['Wills Federal', 'WF']
];

/** Asset keys mentioned in a phrase, e.g. "MLMU #141 and #142" → ["MLMU-141", "MLMU-142"]. */
export function assetMentions(sentence: string): string[] {
	const out: string[] = [];
	let current: string | null = null;
	const alternatives = PREFIX.map(([p], i) => `(?<p${i}>${p.replace(/\((?!\?)/g, '(?:')})`).join('|');
	const re = new RegExp(`(?<pre>${alternatives})\\s*#\\s*(?<n>\\d+)\\b|#(?<bare>\\d+)\\b`, 'gi');
	for (const m of sentence.matchAll(re)) {
		const g = m.groups ?? {};
		if (g.pre) {
			const i = PREFIX.findIndex((_, idx) => g[`p${idx}`] !== undefined);
			let code = PREFIX[i][1];
			if (code === 'RYCF') code = `RYCF${/Com (\d)/i.exec(g.pre)?.[1] ?? ''}`;
			current = code;
			out.push(`${code}-${Number(g.n)}`);
		} else if (current && g.bare) {
			out.push(`${current}-${Number(g.bare)}`);
		}
	}
	return out;
}

function leaseRows(lines: string[]): DailyReport['leases'] {
	const leases: DailyReport['leases'] = {};
	const start = lines.findIndex((l) => /^Lease\b/i.test(l) && /Yesterday/i.test(l));
	if (start === -1) return leases;
	// name, water, water 30-day, oil, oil 30-day, own water, own water 30-day
	const row = new RegExp(`^([A-Za-z][A-Za-z .]*?) ${NUM} ${NUM} ${NUM} ${NUM} ${NUM} ${NUM}$`, 'i');
	for (const line of lines.slice(start + 1, start + 12)) {
		const m = row.exec(line);
		if (!m) continue;
		if (/^total$/i.test(m[1].trim())) break;
		leases[m[1].trim()] = {
			water: num(m[2]),
			water30: num(m[3]),
			oil: num(m[4]),
			oil30: num(m[5]),
			own_water: num(m[6]),
			own_water30: num(m[7])
		};
	}
	return leases;
}

function injectorRows(lines: string[]): DailyReport['injectors'] {
	const injectors: DailyReport['injectors'] = {};
	const start = lines.findIndex((l) => /^Injector\b/i.test(l) && /\(bbl\)/i.test(l));
	if (start === -1) return injectors;
	// name ending in "#n", then yesterday's and the prior day's volume
	const row = new RegExp(`^(.+?#\\s*\\d+) ${NUM} ${NUM}\\b`, 'i');
	for (const line of lines.slice(start + 1, start + 40)) {
		if (/^(All other|Total)\b/i.test(line)) break;
		const m = row.exec(line);
		if (!m) continue;
		const key = assetMentions(m[1])[0];
		if (!key || injectors[key]) continue;
		injectors[key] = { name: m[1].trim(), vol: num(m[2]), vol_prior: num(m[3]) };
	}
	return injectors;
}

export type ReportTextResult = { ok: true; report: DailyReport } | { ok: false; reason: string };

/** Parses a report's page texts (in page order) for the given date. */
export function parseReportText(pages: string[], date: string): ReportTextResult {
	const text = pages.join('\n');
	const lines = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

	const other = /All other injectors \((\d+)\):?\s*([\d,.]+|No Data)/i.exec(text);
	const report = {
		date,
		water: labelled(text, `Water injected \\(bbl\\/day\\):?\\s*${NUM}`),
		oil: labelled(text, `Oil produced \\(bbl\\/day\\):?\\s*${NUM}`),
		own_water: labelled(text, `Own produced water \\(bbl\\/day\\):?\\s*${NUM}`),
		third_party: labelled(text, `Third-party water:?\\s*${NUM}\\s*bbl`),
		inj_taking: pair(text, 'Injectors taking water'),
		wells_running: pair(text, 'Wells running'),
		leases: leaseRows(lines),
		injectors: injectorRows(lines),
		other_injectors: other ? { count: Number(other[1]), vol: num(other[2]) } : null
	};

	const found = [report.water, report.oil, report.inj_taking, report.wells_running].some((v) => v !== null);
	if (!found) return { ok: false, reason: 'None of the report’s header figures were found in the text.' };

	const parsed = dailyReportSchema.safeParse(report);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return { ok: false, reason: `Unexpected shape at ${issue.path.join('.') || '(root)'}: ${issue.message}` };
	}
	return { ok: true, report: parsed.data };
}
