import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { AmplifiedError, getAssets, getData } from '../amplified/client.ts';
import { isAmplifiedConfigured } from '../amplified/config.ts';
import type { AssetResult, TagData } from '../amplified/types.ts';
import { leaseArea, type LiveLease, type LiveRunStatus, type LiveSnapshot, type LiveState, type LiveTicket, type LiveWell } from '../../leaco/ops/live.ts';

/**
 * Pulls the current Amplified data for LeaCo and saves it as a snapshot the dashboard reads.
 * Read-only (GET) and about 7 requests per run, well under the 100/minute limit.
 *
 * Wells are linked through the reviewed worksheet (docs/leaco/amplified-findings.md): only rows
 * with a new ID and no open "CONFIRM" note are used, so nothing is matched by guesswork. Once
 * LeaCo sets those IDs in Amplified, the API's customer_asset_id will equal ours directly.
 *
 * Interim storage: gitignored data/private/amplified/live.json (local). Deployed environments
 * move this to Postgres with the rest of the sync (PLAN §2a).
 */
const DIR = 'data/private/amplified';
const SNAPSHOT = `${DIR}/live.json`;
const WORKSHEET = `${DIR}/customer-id-worksheet.csv`;
const COMBINED = 'data/private/combined_data.json';

const WELL_TAGS = ['well_run_status', 'daily_runtime', 'tubing_pressure', 'casing_pressure', 'last_connection', 'tickets'];
const LEASE_TAGS = ['daily_oil_production', 'daily_water_production'];
const LEASE_DAYS = 30;
const DAY_MS = 86_400_000;

// ---------- reading the link table

function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	for (const line of text.replace(/^﻿/, '').replace(/\r/g, '').split('\n')) {
		if (!line.trim()) continue;
		const cells: string[] = [];
		let cur = '';
		let quoted = false;
		for (let i = 0; i < line.length; i++) {
			const ch = line[i];
			if (quoted) {
				if (ch === '"' && line[i + 1] === '"') {
					cur += '"';
					i++;
				} else if (ch === '"') quoted = false;
				else cur += ch;
			} else if (ch === '"') quoted = true;
			else if (ch === ',') {
				cells.push(cur);
				cur = '';
			} else cur += ch;
		}
		cells.push(cur);
		rows.push(cells);
	}
	return rows;
}

type Link = { customerAssetId: string; key: string };

async function readLinks(): Promise<{ links: Link[]; notLinked: Record<string, string> }> {
	const [sheetText, combinedText] = await Promise.all([readFile(WORKSHEET, 'utf8'), readFile(COMBINED, 'utf8')]);
	const [header, ...rows] = parseCsv(sheetText);
	const col = (name: string) => header.indexOf(name);
	const [cType, cWell, cCurrent, cCheck] = ['type', 'leaco_well', 'current_customer_asset_id', 'check'].map(col);
	if ([cType, cWell, cCurrent, cCheck].some((c) => c < 0)) throw new Error('The ID worksheet is missing a column.');

	const assets = (JSON.parse(combinedText) as { assets: { key: string }[] }).assets;
	const ourKeys = new Set(assets.map((a) => a.key));

	const links: Link[] = [];
	const linked = new Set<string>();
	const pending = new Map<string, string>();
	for (const r of rows) {
		if (r[cType] !== 'well') continue;
		// leaco_well says which of our wells the row is, even when no new ID exists yet.
		const key = r[cWell];
		if (!key || !ourKeys.has(key)) continue;
		if (r[cCheck]) pending.set(key, r[cCheck].replace(/^CONFIRM:\s*/, ''));
		else {
			links.push({ customerAssetId: r[cCurrent], key });
			linked.add(key);
		}
	}
	const notLinked: Record<string, string> = {};
	for (const a of assets) {
		if (linked.has(a.key)) continue;
		notLinked[a.key] = pending.get(a.key) ?? 'No Amplified asset with an ID was found for this well.';
	}
	return { links, notLinked };
}

// ---------- shaping values

const good = (d: TagData | undefined) => (d && d.quality !== 'Bad' ? d.value : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

function runStatus(v: unknown): LiveRunStatus | null {
	return v === 'Running' || v === 'Shutdown' || v === 'Idle' ? v : null;
}

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

function toWell(r: AssetResult, key: string): LiveWell {
	return {
		key,
		customerAssetId: r.metadata.customer_asset_id ?? '',
		amplifiedId: r.metadata.amplified_id ?? null,
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

// ---------- sync

let running: Promise<LiveState> | null = null;

/** Runs one sync. Concurrent callers share the same run. */
export function syncAmplified(): Promise<LiveState> {
	running ??= runSync().finally(() => (running = null));
	return running;
}

async function runSync(): Promise<LiveState> {
	if (!isAmplifiedConfigured()) return { status: 'none', reason: 'AMPLIFIED_API_KEY is not set in this environment.' };
	let previous: LiveSnapshot | null = null;
	try {
		previous = JSON.parse(await readFile(SNAPSHOT, 'utf8')) as LiveSnapshot;
	} catch {
		/* first run */
	}

	try {
		const { links, notLinked } = await readLinks();
		const assets = await getAssets();
		const available = new Set(assets.wells);
		const warnings: string[] = [];

		const active = links.filter((l) => available.has(l.customerAssetId));
		for (const l of links) if (!available.has(l.customerAssetId)) notLinked[l.key] = `Amplified no longer lists ${l.customerAssetId}.`;

		const wellResults = await getData({ assets: active.map((l) => ({ type: 'well' as const, customer_asset_id: l.customerAssetId, tags: WELL_TAGS })) });
		const keyById = new Map(active.map((l) => [l.customerAssetId, l.key]));
		const wells: Record<string, LiveWell> = {};
		for (const r of wellResults) {
			const key = keyById.get(r.metadata.customer_asset_id ?? '');
			if (!key) continue;
			wells[key] = toWell(r, key);
			// Expected per docs: LATEST-only tags never error in LATEST mode, so an error here is worth surfacing.
			for (const e of r.errors) warnings.push(`${key}: ${e}`);
		}

		const now = Date.now();
		const todayUtc = new Date(now).toISOString().slice(0, 10);
		const leaseResults = await getData({
			assets: assets.leases.map((id) => ({ type: 'lease' as const, customer_asset_id: id, tags: LEASE_TAGS })),
			start: now - LEASE_DAYS * DAY_MS,
			end: now
		});
		const leases = leaseResults.map((r) => toLease(r, todayUtc));
		for (const r of leaseResults) for (const e of r.errors) warnings.push(`${r.metadata.customer_asset_id}: ${e}`);

		const snapshot: LiveSnapshot = { syncedAt: new Date(now).toISOString(), wells, leases, notLinked, warnings };
		await mkdir(DIR, { recursive: true });
		await writeFile(`${SNAPSHOT}.tmp`, JSON.stringify(snapshot));
		await rename(`${SNAPSHOT}.tmp`, SNAPSHOT); // never leave a half-written snapshot
		return { status: 'ok', snapshot };
	} catch (err) {
		// The message is safe to show: AmplifiedError never contains the key or a raw payload.
		const reason = err instanceof AmplifiedError ? err.message : err instanceof Error ? err.message : 'Sync failed.';
		return { status: 'error', reason, snapshot: previous };
	}
}

/** The last saved snapshot, without calling Amplified. */
export async function readLiveSnapshot(): Promise<LiveState> {
	try {
		return { status: 'ok', snapshot: JSON.parse(await readFile(SNAPSHOT, 'utf8')) as LiveSnapshot };
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			return {
				status: 'none',
				reason: isAmplifiedConfigured() ? 'Not synced from Amplified yet.' : 'AMPLIFIED_API_KEY is not set in this environment.'
			};
		}
		return { status: 'error', reason: 'The saved Amplified snapshot could not be read.', snapshot: null };
	}
}
