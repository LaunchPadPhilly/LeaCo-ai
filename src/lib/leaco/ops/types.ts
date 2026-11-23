/**
 * The data the /dashboard operations view works from, already normalized on the server
 * (src/lib/server/leaco/opsData.ts). Everything is aligned to `dates`: index i in any
 * per-day array is the report for `dates[i]`. `null` always means "not reported"; it is
 * never a stand-in for zero (brief §4 rule 1).
 */

export type AreaKey = 'mlmu' | 'eeu' | 'rw';
export type PropertyKey = AreaKey | 'winkler' | 'crawford';
export type LonLat = [number, number];

/** `idle` (not pumping right now) only comes from Amplified's live status. */
export type WellStatus = 'run' | 'down' | 'idle' | 'nodata' | 'unk';
export type InjectorStatus = 'take' | 'stuck' | 'idle' | 'nodata';

/** How an injector's volume appears in a day's report. */
export type VolumeSource =
	/** Its own row in the injector table, with a number. */
	| 'reading'
	/** Its own row, marked "No Data". */
	| 'no-reading'
	/** Not listed; the report lumps it into "all other injectors". */
	| 'grouped'
	/** Not in the report at all. */
	| 'absent';

export type AssetDay = {
	/** Raw status code from the report for this day, or null if none. */
	status: string | null;
	volume: number | null;
	pressure: number | null;
	volumeSource: VolumeSource;
	/** "All other injectors" took a small, non-zero amount that day. */
	groupedSmall: boolean;
	/** Runtime % the narrative mentions for this well, if any. */
	runtime: number | null;
	/** Sentences from that day's narrative that mention this asset. */
	notes: string[];
};

export type OpsAsset = {
	key: string;
	name: string;
	kind: 'well' | 'injector';
	area: AreaKey;
	/** Null when no public state record gives a location: the asset is listed, but not on the map. */
	lon: number | null;
	lat: number | null;
	api: string | null;
	stateName: string | null;
	operator: string | null;
	landType: string | null;
	amplifiedId: string | null;
	customerId: string | null;
	/** Known ID or lease problem from the asset list. Shown, never resolved silently. */
	idNote: string | null;
	/** Latest pumper note from the Amplified snapshot, with its own date prefix. */
	pumperNote: string | null;
	snapshotDate: string | null;
	/** Amplified snapshot fields (wells only), as text the snapshot gave. */
	runtimeLatest: string | null;
	runtime7: string | null;
	runtime13: string | null;
	controlMode: string | null;
	/** Daily-report history. Empty in Amplified mode, where status comes from `liveStatus`. */
	days: AssetDay[];
	/** Amplified's current run status, used when there is no report history. */
	liveStatus?: 'Running' | 'Shutdown' | 'Idle' | null;
};

export type DayTotal = {
	/** Water injected (daily reports). Amplified has no injection data. */
	water: number | null;
	oil: number | null;
	/** LeaCo's own produced water (Amplified lease ledger). */
	producedWater?: number | null;
	/** Report header counts, authoritative for the KPIs (PLAN D4). */
	injectorsTaking: [number, number] | null;
	wellsRunning: [number, number] | null;
};

export type AreaDay = { water: number | null; oil: number | null; oil30: number | null; producedWater?: number | null };

export type Ring = LonLat[];
export type Polygon = Ring[];

/** Shortest public-road drive between two areas (computed; not confirmed with LeaCo). */
export type Route = { from: string; to: string; miles: number; via: [string, number][]; lines: LonLat[][] };

/** A stretch with no mapped public road, e.g. Winkler Ranch's last ~1.1 mi. */
export type RoadGap = { area: string; miles: number; line: LonLat[] };

export type OpsData = {
	/**
	 * `reports`: built from the private daily-report files (local). `amplified`: built from the live
	 * Amplified API plus public state records; anything neither provides is null ("No data").
	 */
	mode: 'reports' | 'amplified';
	dates: string[];
	totals: DayTotal[];
	areas: Record<AreaKey, AreaDay[]>;
	assets: OpsAsset[];
	/** Convex hulls of each area's well locations: approximate, not lease lines. */
	hulls: Record<AreaKey, Ring>;
	winklerBoundary: Polygon[];
	winklerBoundaryLabel: string | null;
	crawford: Polygon[];
	stateLine: LonLat[][];
	texas: Polygon[];
	routes: Route[];
	roadGaps: RoadGap[];
	/** Daily-report reconciliation result per date (rule 4), where the parsed report exists. */
	reconciliation: Record<string, 'exact' | 'rounding' | 'mismatch' | 'no-data'>;
	source: string;
};
