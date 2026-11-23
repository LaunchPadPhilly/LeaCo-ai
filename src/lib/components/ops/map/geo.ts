import { geoDistance, geoMercator, type GeoProjection } from 'd3';
import type { LonLat, Polygon } from '$lib/leaco/ops/types';

/**
 * Map geometry. The projection works in a fixed VIEW×VIEW space covering every LeaCo area;
 * d3-zoom maps that space to the screen, so resizing never re-projects anything.
 */
export const VIEW = 1000;

/** South-west and north-east corners of "all areas" (from the prototype). */
export const ALL_AREAS: [LonLat, LonLat] = [
	[-103.32, 31.95],
	[-103.08, 32.73]
];

export function makeProjection(): GeoProjection {
	return geoMercator().fitExtent(
		[
			[0, 0],
			[VIEW, VIEW]
		],
		{ type: 'LineString', coordinates: ALL_AREAS }
	);
}

export type Projector = (c: LonLat) => [number, number];

export function projector(proj: GeoProjection): Projector {
	return (c) => proj(c) as [number, number];
}

export function lineD(P: Projector, coords: LonLat[], close = false): string {
	if (!coords.length) return '';
	return 'M' + coords.map((c) => P(c).map((n) => n.toFixed(1)).join(',')).join('L') + (close ? 'Z' : '');
}

/** Polygons with holes, drawn with the even-odd rule. */
export function polygonsD(P: Projector, polygons: Polygon[]): string {
	return polygons.map((rings) => rings.map((r) => lineD(P, r, true)).join('')).join('');
}

export function boundsOf(points: LonLat[]): [LonLat, LonLat] {
	const xs = points.map((p) => p[0]);
	const ys = points.map((p) => p[1]);
	return [
		[Math.min(...xs), Math.min(...ys)],
		[Math.max(...xs), Math.max(...ys)]
	];
}

/** Rotate point (x, y) by `deg` about (px, py). */
export function rotatePoint(x: number, y: number, deg: number, px: number, py: number): [number, number] {
	const r = (deg * Math.PI) / 180;
	const c = Math.cos(r);
	const s = Math.sin(r);
	const dx = x - px;
	const dy = y - py;
	return [px + dx * c - dy * s, py + dx * s + dy * c];
}

const FEET_PER_RADIAN = 20_902_231;
const SCALE_STEPS_FT = [100, 200, 500, 1000, 2000, 2640, 5280, 10560, 26400, 52800, 105600, 264000];

/** Scale bar for `pixelsPer100` screen pixels covering two projected points. */
export function scaleBar(proj: GeoProjection, a: [number, number], b: [number, number]): { px: number; label: string } {
	const ga = proj.invert?.(a);
	const gb = proj.invert?.(b);
	if (!ga || !gb) return { px: 0, label: '' };
	const feetPer100px = geoDistance(ga, gb) * FEET_PER_RADIAN;
	let best = SCALE_STEPS_FT[0];
	for (const s of SCALE_STEPS_FT) if ((s / feetPer100px) * 100 <= 150) best = s;
	return {
		px: (best / feetPer100px) * 100,
		label: best >= 5280 ? `${best / 5280} mi` : best === 2640 ? '½ mi' : `${best.toLocaleString('en-US')} ft`
	};
}
