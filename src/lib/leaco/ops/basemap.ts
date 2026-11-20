import type { LonLat } from './types';

/**
 * Background maps from USGS The National Map: free, no API key, public-domain U.S.
 * government data, served as standard Web Mercator tiles (same projection as our map).
 * We use the tile endpoint, not `export`, so the bbox-widening gotcha in the brief (§6)
 * doesn't apply.
 */
export type BasemapId = 'none' | 'topo' | 'aerial';

export type Basemap = {
	id: BasemapId;
	label: string;
	/** Credit shown on the map whenever this basemap is on. */
	credit: string;
	url?: (z: number, x: number, y: number) => string;
	/** Highest zoom with real tiles; above it the last level is stretched. */
	maxZoom: number;
	/** Washed back a little so LeaCo's own layers stay the loudest thing on the map. */
	opacity: number;
};

const usgs = (service: string) => (z: number, x: number, y: number) =>
	`https://basemap.nationalmap.gov/arcgis/rest/services/${service}/MapServer/tile/${z}/${y}/${x}`;

export const BASEMAPS: Record<BasemapId, Basemap> = {
	none: { id: 'none', label: 'None', credit: '', maxZoom: 0, opacity: 0 },
	topo: {
		id: 'topo',
		label: 'Topographic',
		credit: 'Background: USGS The National Map (Topo)',
		url: usgs('USGSTopo'),
		maxZoom: 16,
		opacity: 0.7
	},
	aerial: {
		id: 'aerial',
		label: 'Aerial photo',
		credit: 'Background: USDA / USGS The National Map orthoimagery',
		url: usgs('USGSImageryOnly'),
		maxZoom: 16,
		opacity: 0.92
	}
};

export const BASEMAP_IDS = ['none', 'topo', 'aerial'] as const;
export const DEFAULT_BASEMAP: BasemapId = 'topo';

export function parseBasemap(raw: string | null): BasemapId | null {
	return BASEMAP_IDS.includes(raw as BasemapId) ? (raw as BasemapId) : null;
}

// ---------- Web Mercator tile math

export function lonToTileX(lon: number, z: number): number {
	return ((lon + 180) / 360) * 2 ** z;
}

export function latToTileY(lat: number, z: number): number {
	const r = (lat * Math.PI) / 180;
	return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

/** North-west and south-east corners of tile (z, x, y) in lon/lat. */
export function tileBounds(z: number, x: number, y: number): { nw: LonLat; se: LonLat } {
	const n = 2 ** z;
	const lon = (tx: number) => (tx / n) * 360 - 180;
	const lat = (ty: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
	return { nw: [lon(x), lat(y)], se: [lon(x + 1), lat(y + 1)] };
}

/**
 * Zoom level whose tiles show at about `targetPx` on screen. `pxPerRadian` is how many screen
 * pixels one radian of longitude covers (projection scale × zoom factor).
 */
export function zoomFor(pxPerRadian: number, targetPx = 256): number {
	return Math.round(Math.log2((pxPerRadian * 2 * Math.PI) / targetPx));
}

export type Tile = { z: number; x: number; y: number };

/** Tiles covering a lon/lat box at zoom z, or null when that would be more than `max` tiles. */
export function tilesFor([[w, s], [e, n]]: [LonLat, LonLat], z: number, max = 120): Tile[] | null {
	const count = 2 ** z;
	const clampT = (v: number) => Math.min(count - 1, Math.max(0, Math.floor(v)));
	const x0 = clampT(lonToTileX(w, z));
	const x1 = clampT(lonToTileX(e, z));
	const y0 = clampT(latToTileY(n, z));
	const y1 = clampT(latToTileY(s, z));
	if ((x1 - x0 + 1) * (y1 - y0 + 1) > max) return null;
	const out: Tile[] = [];
	for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ z, x, y });
	return out;
}
