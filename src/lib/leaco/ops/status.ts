import type { InjectorStatus, OpsAsset, WellStatus } from './types';
import type { Period } from './period';

/**
 * Status → color, symbol and words, in one table (brief §3 colors, §8 "colors not the
 * only signal"). Wells are circles and injectors are triangles. A ✕ marks down/stuck, and
 * no data is a dashed gray outline, so the map still reads in grayscale.
 */
export type StatusStyle = { label: string; short: string; color: string; mark: 'fill' | 'cross' | 'outline' | 'dashed' };

export const WELL_STATUS: Record<WellStatus, StatusStyle> = {
	run: { label: 'Running', short: 'running', color: '#23733A', mark: 'fill' },
	down: { label: 'Down / shut off', short: 'down', color: '#B42318', mark: 'cross' },
	idle: { label: 'Idle: not pumping right now', short: 'idle', color: '#9A6A00', mark: 'outline' },
	nodata: { label: 'No data', short: 'no data', color: '#6B7280', mark: 'dashed' },
	unk: { label: 'Not mentioned in this report', short: 'not reported', color: '#6B7280', mark: 'outline' }
};

export const INJECTOR_STATUS: Record<InjectorStatus, StatusStyle> = {
	take: { label: 'Taking water', short: 'taking water', color: '#1F5FBF', mark: 'fill' },
	stuck: { label: 'Stuck: pressure but no flow', short: 'stuck', color: '#B42318', mark: 'cross' },
	idle: { label: 'Idle: no flow', short: 'idle', color: '#5B8FD6', mark: 'outline' },
	nodata: { label: 'No volume reading', short: 'no reading', color: '#6B7280', mark: 'dashed' }
};

const WELL_CODES = new Set<WellStatus>(['run', 'down', 'idle', 'nodata', 'unk']);

/** Amplified's live status → our well status (no reading → no data). */
function liveWell(s: OpsAsset['liveStatus']): WellStatus {
	return s === 'Running' ? 'run' : s === 'Shutdown' ? 'down' : s === 'Idle' ? 'idle' : 'nodata';
}
const INJECTOR_CODES = new Set<InjectorStatus>(['take', 'stuck', 'idle', 'nodata']);

/** A well's status on the period's last day. Unknown codes count as "not mentioned". */
export function wellStatus(asset: OpsAsset, p: Period): WellStatus {
	if (!asset.days.length) return liveWell(asset.liveStatus);
	const code = asset.days[p.e]?.status;
	return code && WELL_CODES.has(code as WellStatus) ? (code as WellStatus) : 'unk';
}

export type InjectorPeriod = {
	status: InjectorStatus;
	/** Barrels from its own table rows in the period; null when it had no reading on any day. */
	volume: number | null;
	daysTaking: number;
};

/**
 * An injector over the period: "taking water" if it took water on any day in it, otherwise
 * its status on the last day (as the prototype did). A missing code is "no data", never
 * assumed idle.
 */
export function injectorPeriod(asset: OpsAsset, p: Period): InjectorPeriod {
	// No report history (Amplified mode): Amplified has no injection data, so this is unknown.
	if (!asset.days.length) return { status: 'nodata', volume: null, daysTaking: 0 };
	let daysTaking = 0;
	let volume = 0;
	let readings = 0;
	for (let i = p.s; i <= p.e; i++) {
		const day = asset.days[i];
		if (!day) continue;
		if (day.status === 'take') daysTaking++;
		if (day.volumeSource === 'reading' && day.volume !== null) {
			volume += day.volume;
			readings++;
		}
	}
	const lastCode = asset.days[p.e]?.status;
	const last = lastCode && INJECTOR_CODES.has(lastCode as InjectorStatus) ? (lastCode as InjectorStatus) : 'nodata';
	return { status: daysTaking ? 'take' : last, volume: readings ? volume : null, daysTaking };
}

export function assetStyle(asset: OpsAsset, p: Period): StatusStyle {
	return asset.kind === 'well' ? WELL_STATUS[wellStatus(asset, p)] : INJECTOR_STATUS[injectorPeriod(asset, p).status];
}
