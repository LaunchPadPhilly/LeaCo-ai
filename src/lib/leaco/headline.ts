import type { DailyReport } from './dailyReport';
import {
	changeFrom,
	displayPct,
	injectorRowsTaking,
	reconcile,
	sortByDate,
	summarize,
	type Change,
	type PeriodSummary,
	type Reconciliation
} from './rules';

/** Serializable headline numbers for the dashboard header (brief §3, "Header KPIs"). */
export type Headline = {
	asOf: string;
	priorDate: string | null;
	firstDate: string;
	reportCount: number;
	water: { value: number | null; change: Change | null; last7: PeriodSummary; allReports: PeriodSummary };
	oil: { value: number | null; change: Change | null; last7: PeriodSummary };
	wells: { running: number; total: number; pct: number | null; change: Change | null } | null;
	injectors: {
		taking: number;
		total: number;
		pct: number | null;
		change: Change | null;
		/** Row-based count, shown next to the header count when they differ (PLAN D4). */
		rowsTaking: number;
	} | null;
	reconciliation: Reconciliation;
};

export function buildHeadline(input: DailyReport[]): Headline | null {
	const reports = sortByDate(input);
	const latest = reports.at(-1);
	if (!latest) return null;
	const prior = reports.at(-2) ?? null;
	const last7 = reports.slice(-7);

	const pair = (p: [number, number] | null, q: [number, number] | null | undefined) =>
		p && { running: p[0], total: p[1], pct: displayPct(p[0], p[1]), change: changeFrom(p[0], q?.[0] ?? null) };

	const wells = pair(latest.wells_running, prior?.wells_running);
	const inj = pair(latest.inj_taking, prior?.inj_taking);

	return {
		asOf: latest.date,
		priorDate: prior?.date ?? null,
		firstDate: reports[0].date,
		reportCount: reports.length,
		water: {
			value: latest.water,
			change: changeFrom(latest.water, prior?.water ?? null),
			last7: summarize(last7, 'water'),
			allReports: summarize(reports, 'water')
		},
		oil: {
			value: latest.oil,
			change: changeFrom(latest.oil, prior?.oil ?? null),
			last7: summarize(last7, 'oil')
		},
		wells,
		injectors: inj && {
			taking: inj.running,
			total: inj.total,
			pct: inj.pct,
			change: inj.change,
			rowsTaking: injectorRowsTaking(latest)
		},
		reconciliation: reconcile(latest)
	};
}
