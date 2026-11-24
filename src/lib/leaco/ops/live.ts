import type { AreaKey } from './types';

/**
 * Live data from the Amplified Customer API (docs/leaco/amplified-findings.md). It sits beside
 * the daily-report data rather than replacing it: Amplified has no injected-water figures.
 * A `Bad`-quality or missing value is null, never zero.
 */
export type LiveRunStatus = 'Running' | 'Shutdown' | 'Idle';

export type LiveTicket = {
	id: number | null;
	title: string;
	type: string | null;
	priority: string | null;
	status: string | null;
	created: string | null;
	assetName: string | null;
};

/**
 * How an Amplified well is tied to a public state record: confirmed in the ID worksheet,
 * probable (same lease and number, Amplified labels the kind differently), or none.
 */
export type LiveLink = 'confirmed' | 'probable' | null;

export type LiveWell = {
	/** Our asset key (e.g. EEU-21) when linked to a state record, else `AMP-<customer_asset_id>`. */
	key: string;
	customerAssetId: string;
	amplifiedId: number | null;
	/** Amplified's own name and lease for the asset. */
	name: string;
	leaseName: string | null;
	link: LiveLink;
	/** Why the link is only probable, when it is. */
	linkNote: string | null;
	status: LiveRunStatus | null;
	/** Runtime % for the previous calendar day, Central time (Amplified definition). */
	runtimeYesterday: number | null;
	tubingPressure: number | null;
	casingPressure: number | null;
	/** Last time the well's device checked in (UTC, as Amplified reports it). */
	lastConnection: string | null;
	tickets: LiveTicket[];
};

/** `water` is the lease's produced water, not water injected (Amplified has no injection data). */
export type LiveLeaseDay = { day: string; oil: number | null; water: number | null };

export type LiveLease = {
	customerAssetId: string;
	name: string;
	area: AreaKey;
	/** Complete UTC days only (today's partial day is left out), oldest first. */
	days: LiveLeaseDay[];
};

export type LiveSnapshot = {
	syncedAt: string;
	wells: Record<string, LiveWell>;
	leases: LiveLease[];
	/** State-record wells with no usable Amplified link, and why. */
	notLinked: Record<string, string>;
	/** Requests that failed for part of the data; the rest is still shown. */
	warnings: string[];
};

export type LiveState =
	| { status: 'ok'; snapshot: LiveSnapshot }
	| { status: 'none'; reason: string }
	| { status: 'error'; reason: string; snapshot: LiveSnapshot | null };

/** What the signed-in home page loads for the dashboard. */
export type DashboardLoad = {
	state: 'ok' | 'missing' | 'invalid';
	ops: import('./types').OpsData | null;
	reason: string | null;
	live: LiveState;
	/**
	 * Amplified mode only: the daily reports read from the Dropbox document store, which fill
	 * water injected, wells running and injectors taking water. Empty when none are synced.
	 */
	reports: import('../dailyReport').DailyReport[];
	/** Why some or all report files weren't used, for the page to say so. */
	reportsNote: string | null;
};

export const LIVE_STALE_MS = 15 * 60_000;

export function minutesAgo(iso: string, now = Date.now()): number {
	return Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
}

export function agoText(iso: string, now = Date.now()): string {
	const m = minutesAgo(iso, now);
	if (m < 1) return 'just now';
	if (m < 60) return `${m} min ago`;
	const h = Math.round(m / 60);
	return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

/** Lease → area: MLMU and EEU are their own leases; everything else is the Rhodes & Wills group. */
export function leaseArea(customerAssetId: string): AreaKey {
	if (/^Myers_Langlie_Mattix/i.test(customerAssetId)) return 'mlmu';
	if (/^East_Eumont/i.test(customerAssetId)) return 'eeu';
	return 'rw';
}

/** A device that hasn't checked in for this long is reporting an old status. */
export const OFFLINE_AFTER_MS = 24 * 60 * 60_000;

/** Amplified timestamps are UTC without a zone, e.g. "2026-11-20 21:10:05". */
export function parseAmplifiedTime(t: string | null): number | null {
	if (!t) return null;
	const ms = Date.parse(`${t.trim().replace(' ', 'T')}Z`);
	return Number.isNaN(ms) ? null : ms;
}

/** True when the well's device last checked in more than a day before `now` (or never). */
export function isOffline(w: Pick<LiveWell, 'lastConnection'>, now = Date.now()): boolean {
	const t = parseAmplifiedTime(w.lastConnection);
	return t === null || now - t > OFFLINE_AFTER_MS;
}
