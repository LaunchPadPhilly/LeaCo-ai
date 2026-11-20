import { getAssets, getData } from './client.ts';
import type { AssetResult, TagData } from './types.ts';

/**
 * Read-only aggregations over the Amplified Customer API, shaped for MCP answers:
 * lease production rollups, fleet health, tank activity, series downsampling and
 * asset search. Everything here is derived from upstream GETs; nothing is stored.
 *
 * Amplified timestamps are UTC strings without a zone ("2026-11-20 18:38:20").
 * Outputs use ISO-8601 with `Z` so clients never have to guess the zone.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const START_WINDOW_MS = 30 * 60_000;

// --- Small helpers -----------------------------------------------------------------

export function parseAmplifiedTime(value: unknown): number | null {
	if (typeof value !== 'string' || !value.trim()) return null;
	const iso = value.trim().replace(' ', 'T');
	const ms = Date.parse(/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
	return Number.isNaN(ms) ? null : ms;
}

const isoOrNull = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const dayString = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const startOfUtcDay = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round = (v: number | null, dp = 1) => (v === null ? null : Math.round(v * 10 ** dp) / 10 ** dp);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);

type Point = { at: number; value: unknown; quality?: string };

/** A tag's points, oldest first. A single-point tag (LATEST/CLOSEST) yields one point. */
export function pointsOf(tag: TagData | undefined): Point[] {
	if (!tag) return [];
	const raw = tag.values ?? (tag.value !== undefined ? [tag] : []);
	const points: Point[] = [];
	for (const p of raw) {
		const at = parseAmplifiedTime(p.timestamp);
		if (at !== null) points.push({ at, value: p.value, quality: p.quality });
	}
	return points.sort((a, b) => a.at - b.at);
}

function byId(results: AssetResult[]) {
	const map = new Map<string, AssetResult>();
	for (const r of results) if (r.metadata.customer_asset_id) map.set(r.metadata.customer_asset_id, r);
	return map;
}

// --- Asset naming ------------------------------------------------------------------

/**
 * Field ("lease group") of an asset id, matching how LeaCo's daily report groups leases.
 * Order matters: the more specific Wills names are tested before plain Wills Federal.
 */
const FIELDS: [RegExp, string][] = [
	[/Myers_Langlie_Mattix/i, 'Myers Langlie Mattix'],
	[/East_Eumont/i, 'East Eumont'],
	[/Mr_Wills/i, 'Mr Wills Federal'],
	[/Mary_E_Wills/i, 'Mary E Wills A Federal'],
	[/Wills_Federal/i, 'Wills Federal'],
	[/Rhodes/i, 'Rhodes']
];

export function fieldOf(id: string): string {
	for (const [pattern, field] of FIELDS) if (pattern.test(id)) return field;
	return 'Other';
}

export const fieldNames = [...new Set(FIELDS.map(([, f]) => f))];

export const isInjector = (id: string) => /injector/i.test(id);

// --- Lease production --------------------------------------------------------------

type DailySeries = Map<number, number>;

function dailySeries(tag: TagData | undefined): DailySeries {
	const series: DailySeries = new Map();
	for (const p of pointsOf(tag)) {
		const v = num(p.value);
		if (v !== null && p.quality !== 'Bad') series.set(startOfUtcDay(p.at), v);
	}
	return series;
}

function mergeSeries(all: DailySeries[]): DailySeries {
	const merged: DailySeries = new Map();
	for (const s of all) for (const [day, v] of s) merged.set(day, (merged.get(day) ?? 0) + v);
	return merged;
}

function productionMetrics(series: DailySeries, yesterday: number, monthStart: number) {
	const valuesIn = (from: number, to: number) => {
		const out: number[] = [];
		for (let d = from; d <= to; d += DAY_MS) {
			const v = series.get(d);
			if (v !== undefined) out.push(v);
		}
		return out;
	};
	const y = series.get(yesterday) ?? null;
	const prior = series.get(yesterday - DAY_MS) ?? null;
	const last7 = valuesIn(yesterday - 6 * DAY_MS, yesterday);
	const month = valuesIn(monthStart, yesterday);
	const last30 = valuesIn(yesterday - 29 * DAY_MS, yesterday);
	return {
		yesterday: round(y),
		priorDay: round(prior),
		changePct: y !== null && prior ? round(((y - prior) / prior) * 100, 0) : null,
		avg7Day: round(mean(last7)),
		monthToDate: round(sum(month)),
		monthAvg: round(mean(month)),
		total30Day: round(sum(last30)),
		daysWithData30: last30.length
	};
}

export async function leaseProduction(input: { reportDate?: number; groupBy: 'field' | 'lease' }) {
	const reportDay = startOfUtcDay(input.reportDate ?? Date.now());
	const yesterday = reportDay - DAY_MS;
	const y = new Date(yesterday);
	const monthStart = Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), 1);
	const start = Math.min(monthStart, yesterday - 29 * DAY_MS);

	const { leases } = await getAssets();
	const results = await getData({
		assets: leases.map((id) => ({
			type: 'lease' as const,
			customer_asset_id: id,
			tags: ['daily_oil_production', 'daily_water_production']
		})),
		start,
		// Stop before the report day so its partial (not yet complete) value is excluded.
		end: reportDay - 1
	});

	const perLease = results.map((r) => ({
		id: r.metadata.customer_asset_id ?? 'unknown',
		oil: dailySeries(r.data.daily_oil_production),
		water: dailySeries(r.data.daily_water_production),
		errors: r.errors
	}));

	const groups = new Map<string, typeof perLease>();
	for (const lease of perLease) {
		const key = input.groupBy === 'field' ? fieldOf(lease.id) : lease.id;
		groups.set(key, [...(groups.get(key) ?? []), lease]);
	}

	const allRows = [...groups.entries()].map(([name, members]) => ({
		name,
		leases: members.map((m) => m.id),
		oil: productionMetrics(mergeSeries(members.map((m) => m.oil)), yesterday, monthStart),
		ownWater: productionMetrics(mergeSeries(members.map((m) => m.water)), yesterday, monthStart)
	}));
	const hasData = (r: (typeof allRows)[number]) => r.oil.daysWithData30 > 0 || r.ownWater.daysWithData30 > 0;
	const rows = allRows.filter(hasData).sort((a, b) => (b.oil.total30Day ?? 0) - (a.oil.total30Day ?? 0));
	const noData = allRows.filter((r) => !hasData(r)).map((r) => r.name);

	return {
		reportDate: dayString(reportDay),
		yesterday: dayString(yesterday),
		unit: 'bbl',
		groupBy: input.groupBy,
		rows,
		...(noData.length ? { noData } : {}),
		total: {
			oil: productionMetrics(mergeSeries(perLease.map((l) => l.oil)), yesterday, monthStart),
			ownWater: productionMetrics(mergeSeries(perLease.map((l) => l.water)), yesterday, monthStart)
		},
		errors: perLease.filter((l) => l.errors.length).map((l) => ({ lease: l.id, errors: l.errors })),
		notes: [
			'Days are UTC. A day with no value is absent, not zero; averages are over days with data.',
			'ownWater is water produced on the lease, not injected water. Injection volumes are not available from the Amplified API.',
			'Lease figures already include the tank run tickets: never add tank tickets on top.'
		]
	};
}

// --- Fleet health ------------------------------------------------------------------

const SEVERITY = ['offline', 'error', 'shutdown', 'unknown', 'idle', 'running', 'reporting'] as const;
type HealthStatus = (typeof SEVERITY)[number];

export async function wellHealth(input: {
	staleHours: number;
	lowRuntimePct: number;
	includeTickets: boolean;
	field?: string;
}) {
	const now = Date.now();
	const { wells } = await getAssets();
	const selected = wells.filter((id) => !input.field || fieldOf(id) === input.field);
	const ticketTag = input.includeTickets ? ['tickets'] : [];

	const results = byId(
		selected.length
			? await getData({
					assets: selected.map((id) => ({
						type: 'well' as const,
						customer_asset_id: id,
						tags: isInjector(id)
							? ['last_connection', ...ticketTag]
							: ['well_run_status', 'daily_runtime', 'last_connection', ...ticketTag]
					}))
				})
			: []
	);

	const rows = selected.map((id) => {
		const r = results.get(id);
		const injector = isInjector(id);
		const lastConnection = parseAmplifiedTime(r?.data.last_connection?.value);
		const hoursSilent = lastConnection === null ? null : round((now - lastConnection) / HOUR_MS);
		const runStatus = typeof r?.data.well_run_status?.value === 'string' ? r.data.well_run_status.value : null;
		const runtimePct = round(num(r?.data.daily_runtime?.value));
		const offline = lastConnection === null || (hoursSilent ?? 0) > input.staleHours;

		let status: HealthStatus;
		if (!r || (r.errors.length && !Object.keys(r.data).length)) status = 'error';
		else if (offline) status = 'offline';
		else if (injector) status = 'reporting';
		else if (/shut/i.test(runStatus ?? '')) status = 'shutdown';
		else if (/idle/i.test(runStatus ?? '')) status = 'idle';
		else if (/run/i.test(runStatus ?? '')) status = 'running';
		else status = 'unknown';

		const tickets = pointsOf(r?.data.tickets)
			.map((p) => p.value as { title?: string; priority?: string; created?: string } | null)
			.filter((t): t is NonNullable<typeof t> => Boolean(t));

		return {
			id,
			kind: injector ? 'injector' : 'producer',
			field: fieldOf(id),
			status,
			runStatus,
			runtimePctYesterday: runtimePct,
			lastConnection: isoOrNull(lastConnection),
			hoursSilent,
			...(input.includeTickets
				? {
						openTickets: tickets.length,
						tickets: tickets.slice(0, 5).map((t) => ({ title: t.title, priority: t.priority, created: t.created }))
					}
				: {}),
			...(r?.errors.length ? { errors: r.errors } : {})
		};
	});

	rows.sort((a, b) => SEVERITY.indexOf(a.status) - SEVERITY.indexOf(b.status) || a.id.localeCompare(b.id));

	const producers = rows.filter((r) => r.kind === 'producer');
	const injectors = rows.filter((r) => r.kind === 'injector');
	const count = (list: typeof rows, status: HealthStatus) => list.filter((r) => r.status === status).length;

	return {
		checkedAt: new Date(now).toISOString(),
		staleHours: input.staleHours,
		producers: {
			total: producers.length,
			ranYesterday: producers.filter((r) => (r.runtimePctYesterday ?? 0) > 0).length,
			running: count(producers, 'running'),
			idle: count(producers, 'idle'),
			shutdown: count(producers, 'shutdown'),
			offline: count(producers, 'offline'),
			unknownOrError: count(producers, 'unknown') + count(producers, 'error'),
			lowRuntime: producers
				.filter((r) => r.runtimePctYesterday !== null && r.runtimePctYesterday > 0 && r.runtimePctYesterday < input.lowRuntimePct)
				.map((r) => ({ id: r.id, runtimePctYesterday: r.runtimePctYesterday }))
		},
		injectors: {
			total: injectors.length,
			reporting: count(injectors, 'reporting'),
			offline: count(injectors, 'offline'),
			note:
				'The Amplified API returns no injection volume or pressure for injectors; only whether the device is reporting. ' +
				'Injectors are recognized by "Injector" in their id, so an injector Amplified names without it (e.g. some East Eumont ones) is listed as a producer.'
		},
		wells: rows
	};
}

// --- Tank activity -----------------------------------------------------------------

export async function tankActivity(input: { hours: number; staleHours: number }) {
	const now = Date.now();
	const start = now - input.hours * HOUR_MS;
	const { tanks } = await getAssets();
	if (!tanks.length) return { checkedAt: new Date(now).toISOString(), tanks: [] };

	const asset = (tags: string[]) => tanks.map((id) => ({ type: 'tank' as const, customer_asset_id: id, tags }));
	const latest = byId(await getData({ assets: asset(['volume', 'top_liquid_level', 'high_level', 'last_connection']) }));
	// CLOSEST on tank volume can answer with a current point, so read the first good
	// minute of a short window at the start instead.
	const atStart = byId(await getData({ assets: asset(['volume']), start, end: start + START_WINDOW_MS }));
	const tickets = byId(
		await getData({ assets: asset(['run_ticket_volume', 'run_ticket_fluid_type', 'bsw_ticket_volume']), start, end: now })
	);

	const rows = tanks.map((id) => {
		const l = latest.get(id);
		const s = atStart.get(id);
		const t = tickets.get(id);
		const volumeNow = num(l?.data.volume?.value);
		const startPoint = pointsOf(s?.data.volume).find((p) => p.quality !== 'Bad' && num(p.value) !== null);
		const volumeStart = startPoint ? num(startPoint.value) : null;
		const lastConnection = parseAmplifiedTime(l?.data.last_connection?.value);
		const hoursSilent = lastConnection === null ? null : round((now - lastConnection) / HOUR_MS);

		const fluidAt = new Map(pointsOf(t?.data.run_ticket_fluid_type).map((p) => [p.at, p.value]));
		const pickups = pointsOf(t?.data.run_ticket_volume)
			.filter((p) => num(p.value) !== null)
			.map((p) => ({ at: isoOrNull(p.at), volume: round(num(p.value)), fluid: fluidAt.get(p.at) ?? null }));
		const cleanings = pointsOf(t?.data.bsw_ticket_volume)
			.filter((p) => num(p.value) !== null)
			.map((p) => ({ at: isoOrNull(p.at), volume: round(num(p.value)) }));

		return {
			id,
			field: fieldOf(id),
			volumeNow: round(volumeNow),
			volumeAtWindowStart: round(volumeStart),
			volumeAtWindowStartTime: isoOrNull(startPoint?.at ?? null),
			change: volumeNow !== null && volumeStart !== null ? round(volumeNow - volumeStart) : null,
			levelFt: round(num(l?.data.top_liquid_level?.value), 2),
			highLevelFt: round(num(l?.data.high_level?.value), 2),
			lastConnection: isoOrNull(lastConnection),
			gaugeStale: lastConnection === null || (hoursSilent ?? 0) > input.staleHours,
			pickups,
			bswCleanings: cleanings,
			errors: [...(l?.errors ?? []), ...(t?.errors ?? [])]
		};
	});

	return {
		checkedAt: new Date(now).toISOString(),
		windowHours: input.hours,
		unit: 'bbl',
		summary: {
			tanks: rows.length,
			staleGauges: rows.filter((r) => r.gaugeStale).map((r) => r.id),
			pickups: rows.reduce((n, r) => n + r.pickups.length, 0),
			pickedUpVolume: round(sum(rows.flatMap((r) => r.pickups.map((p) => p.volume ?? 0))))
		},
		tanks: rows,
		notes: [
			'Pickups are filed run tickets in the window; a haul nobody filed is absent.',
			'A drop in volume without a pickup may be an unfiled haul, a transfer or a gauge problem.'
		]
	};
}

// --- Downsampling ------------------------------------------------------------------

/** Replaces a series' raw points with per-hour or per-day {avg,min,max,count} buckets. */
export function downsample(tag: TagData, interval: 'hour' | 'day') {
	if (!tag.values) return tag;
	const size = interval === 'hour' ? HOUR_MS : DAY_MS;
	const buckets = new Map<number, { total: number; min: number; max: number; count: number }>();
	let nonNumeric = 0;
	for (const p of pointsOf(tag)) {
		const v = num(p.value);
		if (v === null || p.quality === 'Bad') {
			nonNumeric++;
			continue;
		}
		const key = Math.floor(p.at / size) * size;
		const b = buckets.get(key);
		if (b) {
			b.total += v;
			b.min = Math.min(b.min, v);
			b.max = Math.max(b.max, v);
			b.count++;
		} else buckets.set(key, { total: v, min: v, max: v, count: 1 });
	}
	return {
		unit: tag.unit,
		interval,
		rawPoints: tag.values.length,
		...(nonNumeric ? { skippedPoints: nonNumeric } : {}),
		buckets: [...buckets.entries()]
			.sort(([a], [b]) => a - b)
			.map(([start, b]) => ({
				start: new Date(start).toISOString(),
				avg: round(b.total / b.count, 3),
				min: b.min,
				max: b.max,
				count: b.count
			}))
	};
}

// --- Asset search ------------------------------------------------------------------

const ALIASES: Record<string, string> = {
	mlmu: 'myers langlie mattix unit',
	eeu: 'east eumont unit',
	mewa: 'mary e wills a',
	nct1: 'nct 1'
};

const tokens = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.split(' ')
		.filter(Boolean);

function queryTokens(query: string) {
	return tokens(query).flatMap((t) => (ALIASES[t] ? tokens(ALIASES[t]) : [t]));
}

/** Every query token must match an asset token: numbers exactly, words by prefix. */
function matches(id: string, query: string[]) {
	const idTokens = tokens(id);
	return query.every((q) => idTokens.some((t) => (/^\d+$/.test(q) ? t === q : t.startsWith(q))));
}

export async function findAssets(input: {
	query?: string;
	kind?: 'producer' | 'injector' | 'tank' | 'lease';
	field?: string;
}) {
	const assets = await getAssets();
	const all = [
		...assets.wells.map((id) => ({ id, type: 'well', kind: isInjector(id) ? 'injector' : 'producer' })),
		...assets.tanks.map((id) => ({ id, type: 'tank', kind: 'tank' })),
		...assets.leases.map((id) => ({ id, type: 'lease', kind: 'lease' }))
	].map((a) => ({ ...a, field: fieldOf(a.id) }));

	const q = input.query ? queryTokens(input.query) : [];
	const found = all.filter(
		(a) =>
			(!input.kind || a.kind === input.kind) &&
			(!input.field || a.field === input.field) &&
			(!q.length || matches(a.id, q))
	);

	const counts: Record<string, number> = {};
	for (const a of found) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
	return { count: found.length, counts, assets: found };
}
