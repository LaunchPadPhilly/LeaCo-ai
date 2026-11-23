import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { reconcile } from '$lib/leaco/rules';
import type { AreaKey, AssetDay, LonLat, OpsAsset, OpsData, Polygon, Ring, VolumeSource } from '$lib/leaco/ops/types';
import { loadDailyReports } from './dailyReports';

/**
 * Builds the /dashboard data from the starter kit's files in gitignored `data/private/`
 * (PLAN D5). Interim: the asset status and volumes move to the Amplified sync (PLAN §2a);
 * locations and land layers stay ours. Paths are relative to the repository root.
 */
const DIR = 'data/private';

const num = z.number().nullable().optional();
const lonLat = z.tuple([z.number(), z.number()]);

const histSchema = z.looseObject({
	d: z.string(),
	v: num,
	p: num,
	o: z.union([z.literal(1), z.boolean()]).optional(),
	sm: z.union([z.literal(1), z.boolean()]).optional(),
	rt: num,
	n: z.array(z.string()).optional()
});

const assetSchema = z.looseObject({
	n: z.string(),
	key: z.string().nullable().optional(),
	k: z.enum(['Well', 'Injector']),
	api: z.string().nullable().optional(),
	sn: z.string().nullable().optional(),
	op: z.string().nullable().optional(),
	lt: z.string().nullable().optional(),
	ar: z.enum(['mlmu', 'eeu', 'rw']),
	x: z.number(),
	y: z.number(),
	rt: z.string().nullable().optional(),
	rt7: z.string().nullable().optional(),
	rt13: z.string().nullable().optional(),
	mode: z.string().nullable().optional(),
	note: z.string().nullable().optional(),
	asof: z.string().nullable().optional(),
	amp_id: z.string().nullable().optional(),
	cust_id: z.string().nullable().optional(),
	id_note: z.string().nullable().optional(),
	ds: z.array(z.string().nullable()).optional(),
	hist: z.array(histSchema).optional()
});

const pair = z.tuple([z.number(), z.number()]).nullable().optional();
const routeSchema = z.looseObject({
	a: z.string(),
	b: z.string(),
	mi: z.number(),
	via: z.array(z.tuple([z.string(), z.number()])),
	g: z.array(z.array(lonLat))
});
const gapSchema = z.looseObject({ a: z.string(), mi: z.number(), g: z.array(lonLat) });

const combinedSchema = z.looseObject({
	routes: z.array(routeSchema).default([]),
	rgaps: z.array(gapSchema).default([]),
	dates_full: z.array(z.iso.date()).min(1),
	assets: z.array(assetSchema),
	hulls: z.object({ mlmu: z.array(lonLat), eeu: z.array(lonLat), rw: z.array(lonLat) }),
	series: z.looseObject({
		dates: z.array(z.string()),
		total: z.array(z.looseObject({ water: num, oil: num, inj: pair, run: pair })),
		areas: z.object({
			mlmu: z.array(z.looseObject({ water: num, oil: num, oil30: num })),
			eeu: z.array(z.looseObject({ water: num, oil: num, oil30: num })),
			rw: z.array(z.looseObject({ water: num, oil: num, oil30: num }))
		})
	})
});

const ranchSchema = z.array(
	z.looseObject({ n: z.string(), g: z.array(z.tuple([z.string(), z.array(lonLat)])) })
);
const geometrySchema = z.object({
	type: z.enum(['Polygon', 'MultiPolygon']),
	coordinates: z.array(z.any())
});
const crawfordSchema = z.looseObject({ crawford: geometrySchema });
const stateSchema = z.looseObject({ line: z.array(z.array(lonLat)), tx: geometrySchema });

export type OpsDataResult = { status: 'ok'; data: OpsData } | { status: 'missing' } | { status: 'invalid'; reason: string };

async function readJson(name: string): Promise<unknown | undefined> {
	try {
		return JSON.parse(await readFile(`${DIR}/${name}`, 'utf8'));
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
		if (err instanceof SyntaxError) throw new InvalidData(`${name} is not valid JSON.`);
		throw err;
	}
}

class InvalidData extends Error {}

function parse<T>(schema: z.ZodType<T>, value: unknown, name: string): T {
	const r = schema.safeParse(value);
	if (!r.success) {
		const issue = r.error.issues[0];
		throw new InvalidData(`${name}: unexpected shape at ${issue.path.join('.') || '(root)'} (${issue.message}).`);
	}
	return r.data;
}

const polygons = (g: z.infer<typeof geometrySchema>): Polygon[] =>
	g.type === 'Polygon' ? [g.coordinates as Polygon] : (g.coordinates as Polygon[]);

function volumeSource(h: z.infer<typeof histSchema> | undefined): VolumeSource {
	if (!h) return 'absent';
	if (h.o) return 'grouped';
	if ('v' in h) return h.v === null || h.v === undefined ? 'no-reading' : 'reading';
	if ('p' in h) return 'no-reading';
	return 'absent';
}

export async function loadOpsData(): Promise<OpsDataResult> {
	// LEACO_KIT=off makes a local run behave like UAT (no private files): used to test Amplified mode.
	if (process.env.LEACO_KIT === 'off') return { status: 'missing' };
	try {
		const [combinedRaw, ranchRaw, crawfordRaw, stateRaw] = await Promise.all(
			['combined_data.json', 'ranch_features.json', 'crawford.json', 'stateline.json'].map(readJson)
		);
		if (combinedRaw === undefined) return { status: 'missing' };

		const c = parse(combinedSchema, combinedRaw, 'combined_data.json');
		const dates = c.dates_full;
		const n = dates.length;
		const mmdd = dates.map((d) => d.slice(5));

		// Every per-day array must line up with the dates; misaligned data is refused, not guessed.
		const lengths = [c.series.dates.length, c.series.total.length, ...Object.values(c.series.areas).map((a) => a.length)];
		if (lengths.some((len) => len !== n) || c.series.dates.some((d, i) => d !== mmdd[i])) {
			throw new InvalidData('combined_data.json: the daily series do not line up with dates_full.');
		}

		const assets: OpsAsset[] = c.assets.map((a) => {
			const byDay = new Map((a.hist ?? []).map((h) => [h.d, h]));
			if (a.ds && a.ds.length !== n) throw new InvalidData(`combined_data.json: ${a.n} has ${a.ds.length} status days, expected ${n}.`);
			const days: AssetDay[] = mmdd.map((d, i) => {
				const h = byDay.get(d);
				return {
					status: a.ds?.[i] ?? null,
					volume: h?.v ?? null,
					pressure: h?.p ?? null,
					volumeSource: a.k === 'Injector' ? volumeSource(h) : 'absent',
					groupedSmall: Boolean(h?.sm),
					runtime: h?.rt ?? null,
					notes: h?.n ?? []
				};
			});
			return {
				key: a.key ?? a.n,
				name: a.n,
				kind: a.k === 'Well' ? 'well' : 'injector',
				area: a.ar,
				lon: a.x,
				lat: a.y,
				api: a.api ?? null,
				stateName: a.sn ?? null,
				operator: a.op ?? null,
				landType: a.lt ?? null,
				amplifiedId: a.amp_id ?? null,
				customerId: a.cust_id ?? null,
				idNote: a.id_note ?? null,
				pumperNote: a.note ?? null,
				snapshotDate: a.asof ?? null,
				runtimeLatest: a.rt ?? null,
				runtime7: a.rt7 ?? null,
				runtime13: a.rt13 ?? null,
				controlMode: a.mode ?? null,
				days
			};
		});

		const areaDays = (k: AreaKey) =>
			c.series.areas[k].map((d) => ({ water: d.water ?? null, oil: d.oil ?? null, oil30: d.oil30 ?? null }));

		const ranch = ranchRaw === undefined ? [] : parse(ranchSchema, ranchRaw, 'ranch_features.json');
		const boundary = ranch.filter((f) => f.n.startsWith('Winkler Ranch'));
		const crawford = crawfordRaw === undefined ? null : parse(crawfordSchema, crawfordRaw, 'crawford.json');
		const state = stateRaw === undefined ? null : parse(stateSchema, stateRaw, 'stateline.json');

		const reconciliation: OpsData['reconciliation'] = {};
		const daily = await loadDailyReports();
		if (daily.status === 'ok') for (const r of daily.reports) reconciliation[r.date] = reconcile(r).status;

		const data: OpsData = {
			mode: 'reports',
			dates,
			totals: c.series.total.map((t) => ({
				water: t.water ?? null,
				oil: t.oil ?? null,
				injectorsTaking: t.inj ?? null,
				wellsRunning: t.run ?? null
			})),
			areas: { mlmu: areaDays('mlmu'), eeu: areaDays('eeu'), rw: areaDays('rw') },
			assets,
			hulls: c.hulls as Record<AreaKey, Ring>,
			winklerBoundary: boundary.flatMap((f) => f.g.filter((g) => g[0] === 'Polygon').map((g) => [g[1] as LonLat[]])),
			winklerBoundaryLabel: boundary[0]?.n ?? null,
			crawford: crawford ? polygons(crawford.crawford) : [],
			stateLine: state?.line ?? [],
			texas: state ? polygons(state.tx) : [],
			routes: c.routes.map((r) => ({ from: r.a, to: r.b, miles: r.mi, via: r.via, lines: r.g })),
			roadGaps: c.rgaps.map((g) => ({ area: g.a, miles: g.mi, line: g.g })),
			reconciliation,
			source: `LeaCo Daily Reports ${dates[0]} to ${dates[n - 1]} (parsed copy from the starter kit)`
		};
		return { status: 'ok', data };
	} catch (err) {
		if (err instanceof InvalidData) return { status: 'invalid', reason: err.message };
		throw err;
	}
}
