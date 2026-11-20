/**
 * The selected time period: inclusive indexes into OpsData.dates. One rule set, used by
 * every number, card, map symbol and popup on the dashboard (brief §3).
 */
export type Period = { s: number; e: number };
export type PeriodPreset = 'day' | '7' | 'all';

export function presetPeriod(preset: PeriodPreset, dayCount: number): Period {
	const last = dayCount - 1;
	return { s: preset === 'day' ? last : preset === '7' ? Math.max(0, last - 6) : 0, e: last };
}

/** Which preset the period matches, if any (for highlighting the preset buttons). */
export function presetOf(p: Period, dayCount: number): PeriodPreset | null {
	for (const preset of ['day', '7', 'all'] as const) {
		const q = presetPeriod(preset, dayCount);
		if (q.s === p.s && q.e === p.e) return preset;
	}
	return null;
}

export function clampPeriod(p: Period, dayCount: number): Period {
	const last = Math.max(0, dayCount - 1);
	const e = Math.min(Math.max(p.e, 0), last);
	return { s: Math.min(Math.max(p.s, 0), e), e };
}

export const dayCountOf = (p: Period) => p.e - p.s + 1;
export const inPeriod = (i: number, p: Period) => i >= p.s && i <= p.e;

/** "Nov 19" from an ISO date, without timezone drift. */
export function shortDay(iso: string): string {
	return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function longDay(iso: string): string {
	return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC'
	});
}

export function periodLabel(dates: string[], p: Period): string {
	return p.s === p.e ? shortDay(dates[p.e]) : `${shortDay(dates[p.s])}–${shortDay(dates[p.e])}`;
}

/** Sum of the reported values in the period, with how many days reported. Null if none did. */
export function sumReported(values: (number | null)[], p: Period): { total: number | null; reported: number } {
	let total = 0;
	let reported = 0;
	for (let i = p.s; i <= p.e; i++) {
		const v = values[i];
		if (v === null || v === undefined) continue;
		total += v;
		reported++;
	}
	return { total: reported ? total : null, reported };
}
