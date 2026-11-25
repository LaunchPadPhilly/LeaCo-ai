import { parseAmplifiedTime, type LiveSnapshot } from '../ops/live';
import { presetPeriod, shortDay } from '../ops/period';
import { PROPERTIES } from '../ops/properties';
import { attention } from '../ops/summary';
import type { OpsAsset, OpsData } from '../ops/types';
import { parsePriority, priorityCounts, type Rules } from './rules';

/**
 * What is wrong right now, one condition per asset and kind (direction A phase 2). The server
 * turns these into LeacoIssue rows (src/lib/server/leaco/issues.ts). Pure: no server imports.
 *
 * `observed` lists the kinds this run actually had data for. An issue of a kind that wasn't
 * observed (e.g. Amplified was unreachable) is left alone, never resolved by mistake.
 */
export type IssueKind = 'SHUTDOWN' | 'IDLE' | 'OFFLINE' | 'TICKET' | 'STUCK' | 'WATER_DROP' | 'REPORT_LATE';

export type Condition = {
	assetKey: string;
	kind: IssueKind;
	assetName: string;
	property: string | null;
	detail: string;
	source: string;
};

export type ConditionRun = { conditions: Condition[]; observed: IssueKind[] };

const HOUR = 3_600_000;

export function findConditions(ops: OpsData | null, live: LiveSnapshot | null, rules: Rules, now: number): ConditionRun {
	const out = new Map<string, Condition>();
	const observed = new Set<IssueKind>();
	const add = (c: Condition) => {
		const id = `${c.assetKey}|${c.kind}`;
		if (!out.has(id)) out.set(id, c);
	};
	const assetOf = (key: string): OpsAsset | null => ops?.assets.find((a) => a.key === key) ?? null;
	const where = (a: OpsAsset | null) => (a ? PROPERTIES[a.area].name : null);

	// ---------- from the daily-report view (and Amplified's current status in Amplified mode)
	if (ops && ops.dates.length) {
		const period = presetPeriod('day', ops.dates.length);
		const label = (i: number) => shortDay(ops.dates[i]);
		const reportDay = `Daily report ${label(period.e)}`;
		observed.add('SHUTDOWN');
		const fromReports = ops.mode === 'reports';
		const hasInjectorReports = ops.assets.some((a) => a.kind === 'injector' && a.days.length);
		if (hasInjectorReports) observed.add('STUCK');

		for (const item of attention(ops, period, null, label)) {
			if (item.severity !== 'high') continue;
			const a = item.asset;
			if (a.kind === 'injector') {
				if (!rules.injector_stuck.enabled) continue;
				add({ assetKey: a.key, kind: 'STUCK', assetName: a.name, property: where(a), detail: item.text, source: reportDay });
			} else if (rules.well_shutdown.enabled) {
				add({ assetKey: a.key, kind: 'SHUTDOWN', assetName: a.name, property: where(a), detail: item.text, source: fromReports ? reportDay : 'Amplified' });
			}
		}

		// Total water injected against the 7 reports before it.
		const reported = ops.totals.map((t, i) => ({ i, water: t.water })).filter((r): r is { i: number; water: number } => r.water !== null);
		if (reported.length >= 8) {
			observed.add('WATER_DROP');
			const last = reported.at(-1)!;
			const prior = reported.slice(-8, -1);
			const avg = prior.reduce((s, r) => s + r.water, 0) / prior.length;
			const drop = avg > 0 ? ((avg - last.water) / avg) * 100 : 0;
			if (rules.water_drop.enabled && drop > (rules.water_drop.threshold ?? 20)) {
				add({
					assetKey: 'ALL',
					kind: 'WATER_DROP',
					assetName: 'All injectors',
					property: null,
					detail: `${Math.round(last.water).toLocaleString('en-US')} bbl on ${label(last.i)}, ${Math.round(drop)}% below the 7-report average of ${Math.round(avg).toLocaleString('en-US')} bbl`,
					source: `Daily report ${label(last.i)}`
				});
			}
		}

		// Daily report not in by the rule's hour (Central time) for the day before.
		if (reported.length) {
			observed.add('REPORT_LATE');
			const lastDay = ops.dates[reported.at(-1)!.i];
			const central = new Date(now - 6 * HOUR); // CST; a DST hour either way doesn't change the answer
			const yesterday = new Date(Date.UTC(central.getUTCFullYear(), central.getUTCMonth(), central.getUTCDate() - 1)).toISOString().slice(0, 10);
			const dueHour = rules.report_late.threshold ?? 9;
			if (rules.report_late.enabled && lastDay < yesterday && central.getUTCHours() >= dueHour) {
				add({
					assetKey: 'REPORTS',
					kind: 'REPORT_LATE',
					assetName: 'Daily report',
					property: null,
					detail: `No report for ${shortDay(yesterday)} yet; the latest is ${shortDay(lastDay)}`,
					source: 'Daily reports'
				});
			}
		}
	}

	// ---------- from Amplified's live snapshot
	if (live) {
		for (const k of ['SHUTDOWN', 'IDLE', 'OFFLINE', 'TICKET'] as const) observed.add(k);
		const offlineAfter = (rules.device_offline.threshold ?? 24) * HOUR;
		const ticketRule = parsePriority(rules.ticket.option);
		for (const w of Object.values(live.wells)) {
			const a = assetOf(w.key);
			const base = { assetKey: w.key, assetName: a?.name ?? w.name, property: where(a) };
			const runtime = w.runtimeYesterday === null ? null : `ran ${Math.round(w.runtimeYesterday)}% yesterday`;
			if (w.status === 'Shutdown' && rules.well_shutdown.enabled) {
				add({ ...base, kind: 'SHUTDOWN', detail: runtime ?? 'shut down right now', source: 'Amplified' });
			}
			if (w.status === 'Idle' && rules.well_idle.enabled) {
				add({ ...base, kind: 'IDLE', detail: runtime ?? 'idle right now', source: 'Amplified' });
			}
			const seen = parseAmplifiedTime(w.lastConnection);
			if (rules.device_offline.enabled && w.status !== null && (seen === null || now - seen >= offlineAfter)) {
				add({ ...base, kind: 'OFFLINE', detail: w.lastConnection ? `no check-in since ${w.lastConnection.slice(0, 16)} UTC; status may be out of date` : 'device has never checked in', source: 'Amplified' });
			}
			if (rules.ticket.enabled) {
				for (const t of w.tickets) {
					if (!priorityCounts(t.priority, ticketRule)) continue;
					add({ ...base, kind: 'TICKET', detail: `${t.title}${t.priority ? ` · ${t.priority}` : ''}`, source: 'Amplified ticket' });
					break; // one ticket issue per well; the detail names the first
				}
			}
		}
	}

	return { conditions: [...out.values()], observed: [...observed] };
}

/** Hours a condition must last before its issue shows (rules with a duration). */
export function minHours(kind: IssueKind, rules: Rules): number {
	if (kind === 'SHUTDOWN') return rules.well_shutdown.threshold ?? 0;
	if (kind === 'IDLE') return rules.well_idle.threshold ?? 24;
	return 0;
}

/** Shown once it has lasted as long as its rule asks. */
export function isVisible(issue: { kind: IssueKind; firstSeenAt: Date | string }, rules: Rules, now: number): boolean {
	return now - new Date(issue.firstSeenAt).getTime() >= minHours(issue.kind, rules) * HOUR;
}
