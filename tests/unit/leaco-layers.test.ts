import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LAYERS, LAYER_IDS, allLayers, parseLayerState, viewsOf, viewState } from '../../src/lib/leaco/ops/layers';
import { loadOpsData } from '../../src/lib/server/leaco/opsData';

describe('layers', () => {
	it('every layer cites a source (brief §4 rule 3)', () => {
		for (const id of LAYER_IDS) expect(LAYERS[id].source.length, id).toBeGreaterThan(0);
	});
	it('approximate or unconfirmed layers say so (rule 2)', () => {
		expect(LAYERS.areas.confidence).toMatch(/approximate/i);
		expect(LAYERS.routes.confidence).toMatch(/not confirmed with LeaCo/);
		expect(LAYERS.crawford.confidence).toMatch(/unconfirmed/i);
	});
	it('recognises every quick set a selection matches, and nothing for a custom one', () => {
		expect(viewsOf(viewState('land'))).toEqual(['land']);
		expect(viewsOf(allLayers(true))).toContain('all');
		expect(viewsOf(viewState('ops'))).toContain('ops');
		expect(viewsOf({ ...viewState('ops'), routes: false })).toEqual([]);
	});
	it('restores a saved choice and ignores junk', () => {
		expect(parseLayerState(JSON.stringify({ routes: false, nonsense: true }))).toEqual({ ...viewState('ops'), routes: false });
		expect(parseLayerState(JSON.stringify({ routes: 'yes' }))).toEqual(viewState('ops'));
		expect(parseLayerState('not json')).toBeNull();
		expect(parseLayerState(null)).toBeNull();
	});
});

const present = existsSync('data/private/combined_data.json');

describe.skipIf(!present)('routes (data/private)', () => {
	it('has the 4 routes and the 1.12 mi Winkler gap', async () => {
		const r = await loadOpsData();
		if (r.status !== 'ok') throw new Error(r.status);
		expect(r.data.routes.map((x) => x.miles)).toEqual([5.4, 20.9, 8.6, 35]);
		expect(r.data.roadGaps).toEqual([expect.objectContaining({ area: 'Winkler Ranch', miles: 1.12 })]);
	});
});
