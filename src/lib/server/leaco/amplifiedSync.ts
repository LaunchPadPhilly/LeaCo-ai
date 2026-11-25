import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { AmplifiedError, getAssets, getData } from '../amplified/client.ts';
import { isAmplifiedConfigured } from '../amplified/config.ts';
import type { AssetResult, TagData } from '../amplified/types.ts';
import {
	LIVE_STALE_MS,
	leaseArea,
	type LiveLease,
	type LiveRunStatus,
	type LiveSnapshot,
	type LiveState,
	type LiveTicket,
	type LiveWell
} from '../../leaco/ops/live.ts';
import reference from '../../leaco/reference/wells.json' with { type: 'json' };

/**
 * The Amplified connector for the dashboard: source → (memory) → dashboard.
 *
 * Pulls every well and lease LeaCo has in Amplified (read-only GET, ~8 requests, well under the
 * 100/minute limit) and keeps the result in this server process's memory, so it works in any
 * container. Wells are tied to public state records (src/lib/leaco/reference/wells.json) only
 * through reviewed links: "confirmed", or "probable" (same lease and number, kind labelled
 * differently). The one conflicting asset is shown on its own, unlinked. Nothing is guessed.
 *
 * Locally, where data/private/ exists, the snapshot is also cached there so a dev-server
 * restart doesn't need a fresh pull. Deployed, it lives in memory and a server timer
 * (startAmplifiedSchedule, started from hooks.server.ts) refreshes it every 15 min.
 */
const CACHE_DIR = 'data/private/amplified';
const CACHE_FILE = `${CACHE_DIR}/live.json`;

const WELL_TAGS = ['well_run_status', 'daily_runtime', 'tubing_pressure', 'casing_pressure', 'last_connection', 'tickets'];
const LEASE_TAGS = ['daily_oil_production', 'daily_water_production'];
/** 60 days so 30-day oil totals can be computed for each of the last 30 days. */
const LEASE_DAYS = 60;
const DAY_MS = 86_400_000;

type RefWell = (typeof reference.wells)[number];

// ---------- links from the committed public reference

function links() {
	const byAmplifiedId = new Map<string, RefWell>();
	const notLinked: Record<string, string> = {};
	for (const w of reference.wells) {
		const link = w.amplified;
		if (link && (link.status === 'confirmed' || link.status === 'probable')) byAmplifiedId.set(link.customerAssetId, w);
		else notLinked[w.key] = link?.note ?? 'No Amplified asset has an ID for this well yet.';
	}
	return { byAmplifiedId, notLinked };
}

// ---------- shaping values (Bad quality or missing → null, never zero)

const good = (d: TagData | undefined) => (d && d.quality !== 'Bad' ? d.value : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
const runStatus = (v: unknown): LiveRunStatus | null => (v === 'Running' || v === 'Shutdown' || v === 'Idle' ? v : null);

function tickets(d: TagData | undefined): LiveTicket[] {
	return (d?.values ?? [])
		.map((p) => p.value as Record<string, unknown> | null)
		.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
		.map((v) => ({
			id: num(v.id),
			title: str(v.title) ?? 'Untitled ticket',
			type: str(v.type),
			priority: str(v.priority),
			status: str(v.status),
			created: str(v.created),
			assetName: str(v.asset_name)
		}));
}

function toWell(r: AssetResult, ref: RefWell | undefined): LiveWell {
	const id = r.metadata.customer_asset_id ?? '';
	const link = ref?.amplified;
	return {
		key: ref ? ref.key : `AMP-${id}`,
		customerAssetId: id,
		amplifiedId: r.metadata.amplified_id ?? null,
		name: r.metadata.asset_name ?? id.replace(/_/g, ' '),
		leaseName: r.metadata.lease_name ?? null,
		link: link?.status === 'confirmed' || link?.status === 'probable' ? link.status : null,
		linkNote: link?.status === 'probable' ? link.note : null,
		status: runStatus(good(r.data.well_run_status)),
		runtimeYesterday: num(good(r.data.daily_runtime)),
		tubingPressure: num(good(r.data.tubing_pressure)),
		casingPressure: num(good(r.data.casing_pressure)),
		lastConnection: str(good(r.data.last_connection)),
		tickets: tickets(r.data.tickets)
	};
}

function toLease(r: AssetResult, todayUtc: string): LiveLease {
	const byDay = new Map<string, { oil: number | null; water: number | null }>();
	for (const [tag, field] of [
		['daily_oil_production', 'oil'],
		['daily_water_production', 'water']
	] as const) {
		for (const p of r.data[tag]?.values ?? []) {
			const day = String(p.timestamp ?? '').slice(0, 10);
			if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day >= todayUtc) continue; // today is still in progress
			const entry = byDay.get(day) ?? { oil: null, water: null };
			entry[field] = p.quality === 'Bad' ? null : num(p.value);
			byDay.set(day, entry);
		}
	}
	const id = r.metadata.customer_asset_id ?? '';
	return {
		customerAssetId: id,
		name: r.metadata.asset_name ?? id.replace(/_/g, ' '),
		area: leaseArea(id),
		days: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, ...v }))
	};
}

// ---------- state

let current: LiveSnapshot | null = null;
let lastError: string | null = null;
let running: Promise<LiveState> | null = null;

/** Runs one sync now. Concurrent callers share the same run. */
export function syncAmplified(): Promise<LiveState> {
	running ??= runSync().finally(() => (running = null));
	return running;
}

async function runSync(): Promise<LiveState> {
	if (!isAmplifiedConfigured()) return { status: 'none', reason: 'AMPLIFIED_API_KEY is not set in this environment.' };
	try {
		const { byAmplifiedId, notLinked } = links();
		const assets = await getAssets();
		const warnings: string[] = [];

		const wellResults = await getData({ assets: assets.wells.map((id) => ({ type: 'well' as const, customer_asset_id: id, tags: WELL_TAGS })) });
		const wells: Record<string, LiveWell> = {};
		for (const r of wellResults) {
			const w = toWell(r, byAmplifiedId.get(r.metadata.customer_asset_id ?? ''));
			wells[w.key] = w;
			for (const e of r.errors) warnings.push(`${w.customerAssetId}: ${e}`);
		}
		// Linked in the reference but no longer listed by Amplified.
		for (const [id, ref] of byAmplifiedId) if (!assets.wells.includes(id)) notLinked[ref.key] = `Amplified no longer lists ${id}.`;

		const now = Date.now();
		const leaseResults = await getData({
			assets: assets.leases.map((id) => ({ type: 'lease' as const, customer_asset_id: id, tags: LEASE_TAGS })),
			start: now - LEASE_DAYS * DAY_MS,
			end: now
		});
		const todayUtc = new Date(now).toISOString().slice(0, 10);
		const leases = leaseResults.map((r) => toLease(r, todayUtc));
		for (const r of leaseResults) for (const e of r.errors) warnings.push(`${r.metadata.customer_asset_id}: ${e}`);

		current = { syncedAt: new Date(now).toISOString(), wells, leases, notLinked, warnings };
		lastError = null;
		await writeLocalCache(current);
		return { status: 'ok', snapshot: current };
	} catch (err) {
		// Safe to show: AmplifiedError never contains the key or a raw payload.
		lastError = err instanceof AmplifiedError ? err.message : 'The Amplified sync failed.';
		return { status: 'error', reason: lastError, snapshot: current };
	}
}

/** Local dev only: keep a copy where the private data folder already exists. */
async function writeLocalCache(s: LiveSnapshot) {
	if (!existsSync(CACHE_DIR)) return;
	try {
		await writeFile(`${CACHE_FILE}.tmp`, JSON.stringify(s));
		await rename(`${CACHE_FILE}.tmp`, CACHE_FILE);
	} catch {
		/* a cache miss just means one more pull next time */
	}
}

async function readLocalCache(): Promise<LiveSnapshot | null> {
	if (!existsSync(CACHE_FILE)) return null;
	try {
		return JSON.parse(await readFile(CACHE_FILE, 'utf8')) as LiveSnapshot;
	} catch {
		return null;
	}
}

const isStale = (s: LiveSnapshot) => Date.now() - Date.parse(s.syncedAt) > LIVE_STALE_MS;

let schedule: ReturnType<typeof setInterval> | null = null;

/**
 * Keeps the copy fresh on a fixed 15-min clock whether or not anyone has the page open, so
 * the first viewer never waits and the data is at most 15 min old. One timer per server
 * process; it never keeps the process alive on its own. A failed pull keeps the last copy.
 */
export function startAmplifiedSchedule(): void {
	if (schedule || !isAmplifiedConfigured()) return;
	void (async () => {
		current ??= await readLocalCache();
		if (!current || isStale(current)) await syncAmplified();
	})();
	schedule = setInterval(() => void syncAmplified(), LIVE_STALE_MS);
	schedule.unref();
}

/**
 * What the page shows. With nothing in memory yet (first request after a deploy) it waits for
 * one pull; with a stale copy it returns that at once and refreshes in the background.
 */
export async function getLiveState(): Promise<LiveState> {
	current ??= await readLocalCache();
	if (!current) return syncAmplified();
	if (isStale(current)) void syncAmplified();
	return lastError ? { status: 'error', reason: lastError, snapshot: current } : { status: 'ok', snapshot: current };
}

/** The current copy without calling Amplified. */
export async function readLiveSnapshot(): Promise<LiveState> {
	current ??= await readLocalCache();
	if (current) return { status: 'ok', snapshot: current };
	return {
		status: 'none',
		reason: isAmplifiedConfigured() ? 'Not synced from Amplified yet.' : 'AMPLIFIED_API_KEY is not set in this environment.'
	};
}
