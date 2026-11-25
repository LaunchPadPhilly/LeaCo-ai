import { isOffline, type LiveSnapshot } from './live';
import type { Period } from './period';
import { PROPERTIES } from './properties';
import { attention } from './summary';
import type { OpsAsset, OpsData } from './types';

/**
 * "Needs a contractor" (DESIGN.md → Layout, top of the Overview): one row per asset that needs
 * a visit, worst first. It joins two sources without mixing their numbers:
 *
 * - the selected period's daily-report view (`attention`): stuck injectors and down wells;
 * - Amplified's live snapshot: wells shut down right now, devices that stopped checking in,
 *   and open tickets.
 *
 * An asset appears once. Each row keeps where its problem came from, so the page can say so.
 */
export type NeedKind = 'shutdown' | 'stuck' | 'offline' | 'ticket';

export type NeedItem = {
	key: string;
	name: string;
	/** Property name, or null when the asset's area isn't known. */
	property: string | null;
	assetKind: 'well' | 'injector';
	kind: NeedKind;
	/** Short status word, e.g. "Shut down". */
	state: string;
	/** What's wrong, in a few words. */
	detail: string;
	/** Where it came from, e.g. "Amplified" or "Daily report Nov 24". */
	source: string;
	/** Present when the asset has a location, so Directions can be offered. */
	location: { lat: number; lon: number } | null;
};

const ORDER: Record<NeedKind, number> = { shutdown: 0, stuck: 1, offline: 2, ticket: 3 };

export function needsContractor(
	ops: OpsData,
	period: Period,
	live: LiveSnapshot | null,
	now: number,
	dayLabel: (i: number) => string
): NeedItem[] {
	const byKey = new Map<string, NeedItem>();
	const assetOf = (key: string) => ops.assets.find((a) => a.key === key) ?? null;
	const base = (a: OpsAsset | null, key: string, name: string): Omit<NeedItem, 'kind' | 'state' | 'detail' | 'source'> => ({
		key,
		name: a?.name ?? name,
		property: a ? PROPERTIES[a.area].name : null,
		assetKind: a?.kind ?? 'well',
		location: a && a.lat !== null && a.lon !== null ? { lat: a.lat, lon: a.lon } : null
	});
	const fromReports = ops.mode === 'reports';

	for (const item of attention(ops, period, null, dayLabel)) {
		if (item.severity !== 'high') continue;
		const a = item.asset;
		const stuck = a.kind === 'injector';
		byKey.set(a.key, {
			...base(a, a.key, a.name),
			kind: stuck ? 'stuck' : 'shutdown',
			state: stuck ? 'Not taking water' : 'Shut down',
			detail: item.text,
			source: fromReports || stuck ? `Daily report ${dayLabel(period.e)}` : 'Amplified'
		});
	}

	for (const w of live ? Object.values(live.wells) : []) {
		const a = assetOf(w.key);
		const existing = byKey.get(w.key);
		const offline = w.status !== null && isOffline(w, now);
		const runtime = w.runtimeYesterday === null ? null : `ran ${Math.round(w.runtimeYesterday)}% yesterday`;

		if (w.status === 'Shutdown' && !existing) {
			byKey.set(w.key, {
				...base(a, w.key, w.name),
				kind: 'shutdown',
				state: 'Shut down',
				detail: runtime ?? 'shut down right now',
				source: 'Amplified'
			});
		}
		if (offline) {
			const row = byKey.get(w.key);
			const note = 'device offline, status may be out of date';
			if (row) {
				row.kind = row.kind === 'shutdown' ? 'offline' : row.kind;
				row.detail = `${row.detail} · ${note}`;
			} else {
				byKey.set(w.key, { ...base(a, w.key, w.name), kind: 'offline', state: 'Offline', detail: note, source: 'Amplified' });
			}
		}
		for (const t of w.tickets) {
			const row = byKey.get(w.key);
			const text = `${t.title}${t.priority ? ` · ${t.priority}` : ''}`;
			if (row) row.detail = `${row.detail} · ticket: ${text}`;
			else byKey.set(w.key, { ...base(a, w.key, w.name), kind: 'ticket', state: 'Open ticket', detail: text, source: 'Amplified ticket' });
		}
	}

	return [...byKey.values()].sort((x, y) => ORDER[x.kind] - ORDER[y.kind] || x.name.localeCompare(y.name));
}

/** "3 wells down · 2 injectors not taking water · 1 open ticket", counting each row once. */
export function needsSummary(items: NeedItem[]): string {
	const n = (k: NeedKind) => items.filter((i) => i.kind === k).length;
	const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
	const parts = [
		n('shutdown') ? plural(n('shutdown'), 'well down', 'wells down') : null,
		n('stuck') ? plural(n('stuck'), 'injector not taking water', 'injectors not taking water') : null,
		n('offline') ? plural(n('offline'), 'device offline', 'devices offline') : null,
		n('ticket') ? plural(n('ticket'), 'open ticket', 'open tickets') : null
	].filter(Boolean);
	return parts.join(' · ');
}
