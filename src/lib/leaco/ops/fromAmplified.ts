import layers from '../reference/layers.json' with { type: 'json' };
import reference from '../reference/wells.json' with { type: 'json' };
import { leaseArea, type LiveSnapshot } from './live';
import type { AreaDay, AreaKey, DayTotal, OpsAsset, OpsData, Polygon, Ring, LonLat } from './types';

/**
 * Dashboard data built from the live Amplified API plus public state records, for environments
 * without the private daily reports (UAT, production). The rule (owner, 2026-11-23): take
 * everything from the API; fill a field from public records where we have it; otherwise leave it
 * null so the page reports it as missing. Nothing is estimated.
 *
 * - Dates are the Amplified lease ledger's complete UTC days (last 30).
 * - Oil and produced water come from the ledger. Water injected, injector volumes and
 *   day-by-day well status are not in Amplified: always null here.
 * - Each well's status is Amplified's current reading (`liveStatus`).
 * - Location, API number, operator and land type come from NM OCD records, through the
 *   reviewed link in reference/wells.json. Unlinked wells have none: listed, not mapped.
 */
const SHOWN_DAYS = 30;
const AREAS: AreaKey[] = ['mlmu', 'eeu', 'rw'];

type Geometry = { type: string; coordinates: unknown };
const polygons = (g: Geometry): Polygon[] => (g.type === 'Polygon' ? [g.coordinates as Polygon] : (g.coordinates as Polygon[]));

/** Amplified lease names use spaces ("Myers Langlie Mattix Unit"); the area rule reads either form. */
const areaOfLease = (leaseName: string | null): AreaKey => leaseArea((leaseName ?? '').replace(/\s+/g, '_'));

export function opsFromAmplified(s: LiveSnapshot): OpsData {
	const allDays = [...new Set(s.leases.flatMap((l) => l.days.map((d) => d.day)))].sort();
	const shown = allDays.slice(-SHOWN_DAYS);
	const dates = shown.length ? shown : [s.syncedAt.slice(0, 10)];

	const sumFor = (day: string, field: 'oil' | 'water', area?: AreaKey): number | null => {
		let sum = 0;
		let n = 0;
		for (const l of s.leases) {
			if (area && l.area !== area) continue;
			const v = l.days.find((d) => d.day === day)?.[field];
			if (v === null || v === undefined) continue;
			sum += v;
			n++;
		}
		return n ? sum : null;
	};
	/** 30-day oil ending on `day`, only when the ledger reaches back the full 30 days. */
	const oil30 = (day: string, area: AreaKey): number | null => {
		const i = allDays.indexOf(day);
		if (i < SHOWN_DAYS - 1) return null;
		let sum = 0;
		let n = 0;
		for (const d of allDays.slice(i - SHOWN_DAYS + 1, i + 1)) {
			const v = sumFor(d, 'oil', area);
			if (v !== null) (sum += v), n++;
		}
		return n ? sum : null;
	};

	const totals: DayTotal[] = dates.map((day) => ({
		water: null,
		oil: shown.length ? sumFor(day, 'oil') : null,
		producedWater: shown.length ? sumFor(day, 'water') : null,
		injectorsTaking: null,
		wellsRunning: null
	}));
	const areas = Object.fromEntries(
		AREAS.map((a) => [
			a,
			dates.map(
				(day): AreaDay => ({
					water: null,
					oil: shown.length ? sumFor(day, 'oil', a) : null,
					oil30: shown.length ? oil30(day, a) : null,
					producedWater: shown.length ? sumFor(day, 'water', a) : null
				})
			)
		])
	) as Record<AreaKey, AreaDay[]>;

	const refByKey = new Map(reference.wells.map((w) => [w.key, w]));
	const assets: OpsAsset[] = Object.values(s.wells).map((w) => {
		const ref = w.link ? refByKey.get(w.key) : undefined;
		return {
			key: w.key,
			name: ref?.name ?? w.name,
			kind: (ref?.kind as OpsAsset['kind'] | undefined) ?? (/injector/i.test(w.name) ? 'injector' : 'well'),
			area: (ref?.area as AreaKey | undefined) ?? areaOfLease(w.leaseName),
			lon: ref?.lon ?? null,
			lat: ref?.lat ?? null,
			api: ref?.api ?? null,
			stateName: ref?.stateName ?? null,
			operator: ref?.operator ?? null,
			landType: ref?.landType ?? null,
			amplifiedId: w.amplifiedId === null ? null : String(w.amplifiedId),
			customerId: w.customerAssetId,
			idNote: ref
				? w.linkNote
				: 'Not linked to a state well record, so its location, API number and operator are missing.',
			pumperNote: null,
			snapshotDate: null,
			runtimeLatest: w.runtimeYesterday === null ? null : `${Math.round(w.runtimeYesterday)}%`,
			runtime7: null,
			runtime13: null,
			controlMode: null,
			days: [],
			liveStatus: w.status
		};
	});

	return {
		mode: 'amplified',
		dates,
		totals,
		areas,
		assets,
		hulls: layers.hulls as Record<AreaKey, Ring>,
		winklerBoundary: [],
		winklerBoundaryLabel: null,
		crawford: polygons(layers.crawford as Geometry),
		stateLine: layers.stateLine as LonLat[][],
		texas: polygons(layers.texas as Geometry),
		routes: layers.routes.map((r) => ({ from: r.a, to: r.b, miles: r.mi, via: r.via as [string, number][], lines: r.g as LonLat[][] })),
		roadGaps: layers.roadGaps.map((g) => ({ area: g.a, miles: g.mi, line: g.g as LonLat[] })),
		reconciliation: {},
		source: 'Amplified Customer API (live) and NM OCD state well records (locations)'
	};
}

/** State-record wells Amplified has no usable link for (shown as "not in Amplified"). */
export function referenceNotInAmplified(s: LiveSnapshot): { key: string; name: string; reason: string }[] {
	return reference.wells
		.filter((w) => s.notLinked[w.key])
		.map((w) => ({ key: w.key, name: w.name, reason: s.notLinked[w.key] }));
}
