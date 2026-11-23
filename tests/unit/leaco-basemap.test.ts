import { describe, expect, it } from 'vitest';
import { BASEMAPS, latToTileY, lonToTileX, parseBasemap, tileBounds, tilesFor, zoomFor } from '../../src/lib/leaco/ops/basemap';

describe('basemap tiles', () => {
	// z12/1661/873 returned a real USGS Topo tile when this was written (2026-11-20).
	it('places Jal, NM in the right z12 tile', () => {
		expect(Math.floor(lonToTileX(-103.2, 12))).toBe(873);
		expect(Math.floor(latToTileY(32.12, 12))).toBe(1661);
	});
	it('tile bounds round-trip through the tile math', () => {
		const { nw, se } = tileBounds(12, 873, 1661);
		expect(Math.floor(lonToTileX(nw[0] + 1e-9, 12))).toBe(873);
		expect(Math.floor(latToTileY(nw[1] - 1e-9, 12))).toBe(1661);
		expect(se[0]).toBeGreaterThan(nw[0]);
		expect(se[1]).toBeLessThan(nw[1]);
	});
	it('covers a box with every tile it touches, and refuses an oversized request', () => {
		const tiles = tilesFor(
			[
				[-103.32, 31.95],
				[-103.08, 32.73]
			],
			10
		);
		expect(tiles?.length).toBeGreaterThan(1);
		expect(tilesFor([[-110, 25], [-95, 40]], 14)).toBeNull();
	});
	it('picks a zoom where tiles render near 256 px', () => {
		expect(zoomFor((256 * 2 ** 10) / (2 * Math.PI))).toBe(10);
	});
	it('builds USGS tile URLs in z/y/x order and credits them', () => {
		expect(BASEMAPS.topo.url!(12, 873, 1661)).toBe(
			'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/12/1661/873'
		);
		expect(BASEMAPS.aerial.credit).toMatch(/USGS/);
		expect(parseBasemap('aerial')).toBe('aerial');
		expect(parseBasemap('google')).toBeNull();
	});
});
