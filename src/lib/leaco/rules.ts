import type { DailyReport } from './dailyReport';

/**
 * Data rules from the brief (reference/PROMPT.md §4) and the plan's decisions
 * (docs/leaco/PLAN.md §3). Pure functions; the server, the UI and the tests all use these.
 */

/**
 * Whole-number percentage, rounded, except that anything short of exactly 100% never shows
 * as 100% (brief §4 rule 6). 999/1000 → 99, not 100. Returns null when there's nothing to
 * divide by. Missing data is not 0%.
 */
export function displayPct(part: number | null, whole: number | null): number | null {
	if (part === null || whole === null || whole <= 0) return null;
	const pct = Math.round((part / whole) * 100);
	return pct >= 100 && part < whole ? 99 : pct;
}

/**
 * Largest gap, in barrels, between a report's total and the sum of its rows that still counts
 * as reconciled. The starter-kit reports differ by up to 3 bbl, consistent with each row being
 * rounded separately (PLAN §2, decision D3). A bigger gap means a parsing or source error.
 */
export const RECONCILE_TOLERANCE_BBL = 3;

export type ReconcileCheck = {
	label: string;
	total: number;
	sum: number;
	gap: number;
	status: 'exact' | 'rounding' | 'mismatch';
};

export type Reconciliation = {
	date: string;
	status: 'exact' | 'rounding' | 'mismatch' | 'no-data';
	checks: ReconcileCheck[];
	/** Injector rows reported as "No data". They add nothing to the sum, and are counted so that's visible. */
	injectorRowsWithoutVolume: number;
};

function check(label: string, total: number, sum: number): ReconcileCheck {
	const gap = Math.round((sum - total) * 10) / 10;
	const status = gap === 0 ? 'exact' : Math.abs(gap) <= RECONCILE_TOLERANCE_BBL ? 'rounding' : 'mismatch';
	return { label, total, sum, gap, status };
}

const worst = (statuses: ReconcileCheck['status'][]): Reconciliation['status'] =>
	statuses.includes('mismatch') ? 'mismatch' : statuses.includes('rounding') ? 'rounding' : 'exact';

/**
 * Brief §4 rule 4: injector rows + "all other injectors" = total water, and the lease
 * rows = total water.
 */
export function reconcile(report: DailyReport): Reconciliation {
	if (report.water === null) {
		return { date: report.date, status: 'no-data', checks: [], injectorRowsWithoutVolume: 0 };
	}
	const injectorRows = Object.values(report.injectors);
	const injectorSum =
		injectorRows.reduce((sum, row) => sum + (row.vol ?? 0), 0) + (report.other_injectors?.vol ?? 0);
	const leaseSum = Object.values(report.leases).reduce((sum, row) => sum + (row.water ?? 0), 0);

	const checks = [
		check('Injector rows + all other injectors', report.water, injectorSum),
		check('Lease rows', report.water, leaseSum)
	];
	return {
		date: report.date,
		status: worst(checks.map((c) => c.status)),
		checks,
		injectorRowsWithoutVolume: injectorRows.filter((row) => row.vol === null).length
	};
}

/** Per-injector rows that show water going in. Can differ from the header count (PLAN D4). */
export function injectorRowsTaking(report: DailyReport): number {
	return Object.values(report.injectors).filter((row) => row.vol !== null && row.vol > 0).length;
}

export type PeriodSummary = {
	total: number | null;
	/** Average over the days that reported a value. Missing days are skipped, never filled. */
	average: number | null;
	daysReported: number;
	daysInPeriod: number;
};

export function summarize(
	reports: DailyReport[],
	field: 'water' | 'oil'
): PeriodSummary {
	const values = reports.map((r) => r[field]).filter((v): v is number => v !== null);
	const total = values.length ? values.reduce((a, b) => a + b, 0) : null;
	return {
		total,
		average: total === null ? null : total / values.length,
		daysReported: values.length,
		daysInPeriod: reports.length
	};
}

export type Change = { delta: number; pct: number | null };

/** Change from the prior day, or null when either day is missing the value. */
export function changeFrom(current: number | null, prior: number | null): Change | null {
	if (current === null || prior === null) return null;
	return { delta: current - prior, pct: prior === 0 ? null : ((current - prior) / prior) * 100 };
}

/** Reports sorted oldest → newest. */
export function sortByDate(reports: DailyReport[]): DailyReport[] {
	return [...reports].sort((a, b) => a.date.localeCompare(b.date));
}
