import { displayPct } from '../rules';
import { sumReported, type Period } from './period';
import { injectorPeriod, wellStatus } from './status';
import type { AreaKey, InjectorStatus, OpsAsset, OpsData, WellStatus } from './types';

export type Headline = {
	single: boolean;
	water: { value: number | null; perDay: number | null; reported: number; change: number | null };
	oil: { value: number | null; perDay: number | null; reported: number; change: number | null };
	/** Header counts on the period's last day. */
	wells: [number, number] | null;
	injectors: [number, number] | null;
	wellsChange: number | null;
	injectorsChange: number | null;
	/** Row-based injector count on the last day, when it differs from the header (PLAN D4). */
	injectorRowsTaking: number;
};

const diff = (a: number | null | undefined, b: number | null | undefined) =>
	a === null || a === undefined || b === null || b === undefined ? null : a - b;

export function headline(data: OpsData, p: Period): Headline {
	const single = p.s === p.e;
	const last = data.totals[p.e];
	const prior = p.e > 0 ? data.totals[p.e - 1] : null;

	const metric = (field: 'water' | 'oil') => {
		const { total, reported } = sumReported(
			data.totals.map((t) => t[field]),
			p
		);
		return {
			value: total,
			perDay: total === null || single ? null : total / reported,
			reported,
			change: single ? diff(last[field], prior?.[field]) : null
		};
	};

	const injectorRowsTaking = data.assets.filter(
		(a) => a.kind === 'injector' && a.days[p.e]?.volumeSource === 'reading' && (a.days[p.e]?.volume ?? 0) > 0
	).length;

	return {
		single,
		water: metric('water'),
		oil: metric('oil'),
		wells: last.wellsRunning,
		injectors: last.injectorsTaking,
		wellsChange: diff(last.wellsRunning?.[0], prior?.wellsRunning?.[0]),
		injectorsChange: diff(last.injectorsTaking?.[0], prior?.injectorsTaking?.[0]),
		injectorRowsTaking
	};
}

export type AreaSummary = {
	key: AreaKey;
	water: number | null;
	oil: number | null;
	waterPerDay: number | null;
	oilPerDay: number | null;
	oil30: number | null;
	/** Share of all water injected in the period (99% rule applies). */
	waterShare: number | null;
	/** Share of LeaCo's 30-day oil, as of the period's last day. */
	oil30Share: number | null;
	wells: Record<WellStatus, number> & { total: number };
	injectors: Record<InjectorStatus, number> & { total: number };
	waterSeries: (number | null)[];
	oilSeries: (number | null)[];
};

export function areaSummary(data: OpsData, key: AreaKey, p: Period): AreaSummary {
	const series = data.areas[key];
	const single = p.s === p.e;
	const water = sumReported(series.map((d) => d.water), p);
	const oil = sumReported(series.map((d) => d.oil), p);
	const allWater = sumReported(data.totals.map((t) => t.water), p).total;
	const oil30 = series[p.e]?.oil30 ?? null;
	const allOil30 = (['mlmu', 'eeu', 'rw'] as const).reduce<number | null>((sum, k) => {
		const v = data.areas[k][p.e]?.oil30;
		return v === null || v === undefined || sum === null ? null : sum + v;
	}, 0);

	const assets = data.assets.filter((a) => a.area === key);
	const wells = { run: 0, down: 0, nodata: 0, unk: 0, total: 0 };
	const injectors = { take: 0, stuck: 0, idle: 0, nodata: 0, total: 0 };
	for (const a of assets) {
		if (a.kind === 'well') {
			wells[wellStatus(a, p)]++;
			wells.total++;
		} else {
			injectors[injectorPeriod(a, p).status]++;
			injectors.total++;
		}
	}

	return {
		key,
		water: water.total,
		oil: oil.total,
		waterPerDay: single || water.total === null ? null : water.total / water.reported,
		oilPerDay: single || oil.total === null ? null : oil.total / oil.reported,
		oil30,
		waterShare: displayPct(water.total, allWater),
		oil30Share: displayPct(oil30, allOil30),
		wells,
		injectors,
		waterSeries: series.map((d) => d.water),
		oilSeries: series.map((d) => d.oil)
	};
}

export type AttentionItem = { asset: OpsAsset; severity: 'high' | 'info'; text: string };

/**
 * What needs a look in the period (prototype "Needs attention"): stuck injectors, down
 * wells with their latest note, and injectors without a reading.
 */
export function attention(data: OpsData, p: Period, area: AreaKey | null, dayLabel: (i: number) => string): AttentionItem[] {
	const assets = data.assets.filter((a) => !area || a.area === area);
	const out: AttentionItem[] = [];
	const single = p.s === p.e;

	for (const a of assets) {
		if (a.kind !== 'injector') continue;
		const st = injectorPeriod(a, p).status;
		const day = a.days[p.e];
		if (st === 'stuck') {
			const reading = day?.volume === null || day?.volume === undefined ? 'no volume reading' : `${day.volume} bbl`;
			const psi = day?.pressure === null || day?.pressure === undefined ? 'no pressure reading' : `${day.pressure} psi`;
			out.push({ asset: a, severity: 'high', text: `Stuck${single ? '' : ', took nothing all period'} (${dayLabel(p.e)}: ${reading}, ${psi})` });
		}
	}
	const down = assets.filter((a) => a.kind === 'well' && wellStatus(a, p) === 'down');
	const lastNote = (a: OpsAsset) => {
		for (let i = p.e; i >= 0; i--) if (a.days[i]?.notes.length) return { i, note: a.days[i].notes[0] };
		return null;
	};
	down.sort((a, b) => Number(Boolean(lastNote(b))) - Number(Boolean(lastNote(a))));
	for (const a of down) {
		const n = lastNote(a);
		out.push({ asset: a, severity: 'high', text: n ? `${dayLabel(n.i)}: ${n.note}` : 'Down / shut off, no recent note' });
	}
	for (const a of assets) {
		if (a.kind === 'injector' && injectorPeriod(a, p).status === 'nodata') {
			out.push({ asset: a, severity: 'info', text: `No volume reading on ${dayLabel(p.e)}` });
		}
	}
	return out;
}
