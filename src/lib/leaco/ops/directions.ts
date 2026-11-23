import type { OpsAsset } from './types';

/**
 * Links for sending someone to a well or injector. Both are the public "open the maps app"
 * URLs: no API key, account or billing. Coordinates are NM OCD locations and are labelled
 * approximate everywhere they're shared (brief §4 rule 2) until a pumper verifies them.
 */
const coord = (n: number) => n.toFixed(5);

/** An asset that has a location. Wells known only to Amplified have none: callers check first. */
export type Located = { lat: number; lon: number };

export function coordinates(a: Located): string {
	return `${coord(a.lat)}, ${coord(a.lon)}`;
}

/** Google Maps directions to the point (Google "Maps URLs"; works in any browser or the app). */
export function googleDirectionsUrl(a: Located): string {
	return `https://www.google.com/maps/dir/?api=1&destination=${coord(a.lat)},${coord(a.lon)}`;
}

/** Apple Maps directions to the point, with the name as the label. */
export function appleDirectionsUrl(a: Located & Pick<OpsAsset, 'name'>): string {
	return `https://maps.apple.com/?daddr=${coord(a.lat)},${coord(a.lon)}&q=${encodeURIComponent(a.name)}`;
}

export const LOCATION_CAVEAT = 'Location is approximate (NM OCD state records), not yet verified on site.';

/** Plain text for a text message or work order. */
export function shareText(a: Located & Pick<OpsAsset, 'name' | 'api' | 'kind'>): string {
	return [
		`${a.name} (${a.kind === 'injector' ? 'injector' : 'producing well'})`,
		a.api ? `API ${a.api}` : null,
		`Coordinates: ${coordinates(a)}`,
		`Google Maps: ${googleDirectionsUrl(a)}`,
		`Apple Maps: ${appleDirectionsUrl(a)}`,
		LOCATION_CAVEAT,
		'Last stretch is on lease roads; confirm the way in and any gates with LeaCo.'
	]
		.filter(Boolean)
		.join('\n');
}
