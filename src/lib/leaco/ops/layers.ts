/**
 * Map layers: name, source and confidence in one table, so no layer can be drawn without
 * its citation (brief §4 rules 2 and 3). The layers panel, the legend and the map all
 * read from here.
 */
export const LAYER_IDS = ['state', 'injectors', 'wells', 'areas', 'dp', 'winkler', 'crawford', 'routes'] as const;
export type LayerId = (typeof LAYER_IDS)[number];
export type LayerState = Record<LayerId, boolean>;

export type LayerDef = {
	id: LayerId;
	name: string;
	/** Who the data comes from. */
	source: string;
	/** Shown when the layer is approximate or unconfirmed. */
	confidence?: string;
};

export type LayerGroup = { title: string; layers: LayerDef[] };

export const LAYER_GROUPS: LayerGroup[] = [
	{
		title: 'LeaCo operations (selected period)',
		layers: [
			{ id: 'injectors', name: 'Injectors', source: 'LeaCo Daily Reports; locations NM OCD', confidence: 'Locations approximate' },
			{ id: 'wells', name: 'Producing wells', source: 'LeaCo Daily Reports; locations NM OCD', confidence: 'Locations approximate' },
			{ id: 'areas', name: 'Operating areas', source: 'Drawn around LeaCo’s well locations', confidence: 'Approximate, not lease lines' },
			{ id: 'dp', name: 'XRI water delivery point', source: 'XRI Water Services Agreement, Annex I' }
		]
	},
	{
		title: 'LeaCo land',
		layers: [
			{ id: 'winkler', name: 'Winkler Ranch', source: 'LeaCo KMZ' },
			{ id: 'crawford', name: 'Crawford Ranch', source: 'BLM NM surface ownership', confidence: 'Ownership unconfirmed' }
		]
	},
	{
		title: 'Getting there',
		layers: [
			{
				id: 'routes',
				name: 'Routes between LeaCo areas',
				source: 'Computed on U.S. Census TIGER roads',
				confidence: 'Shortest drive on public roads, not confirmed with LeaCo'
			}
		]
	},
	{
		title: 'Reference',
		layers: [{ id: 'state', name: 'State line (Texas / New Mexico)', source: 'U.S. Census TIGER' }]
	}
];

export const LAYERS: Record<LayerId, LayerDef> = Object.fromEntries(
	LAYER_GROUPS.flatMap((g) => g.layers).map((l) => [l.id, l])
) as Record<LayerId, LayerDef>;

export type LayerView = 'ops' | 'land' | 'all';

/** Quick sets from the prototype. Land & rights grows when the R3 context layers arrive. */
export const VIEWS: Record<LayerView, { label: string; on: LayerId[] }> = {
	ops: { label: 'Operations', on: ['state', 'injectors', 'wells', 'areas', 'dp', 'winkler', 'crawford', 'routes'] },
	land: { label: 'Land & rights', on: ['state', 'injectors', 'wells', 'dp', 'winkler', 'crawford'] },
	all: { label: 'Everything', on: [...LAYER_IDS] }
};

export function viewState(view: LayerView): LayerState {
	const on = new Set(VIEWS[view].on);
	return Object.fromEntries(LAYER_IDS.map((id) => [id, on.has(id)])) as LayerState;
}

export function allLayers(on: boolean): LayerState {
	return Object.fromEntries(LAYER_IDS.map((id) => [id, on])) as LayerState;
}

/**
 * Every quick set the state matches exactly. Until the land/context layers arrive,
 * Operations and Everything are the same set, so both light up.
 */
export function viewsOf(state: LayerState): LayerView[] {
	return (['ops', 'land', 'all'] as const).filter((v) => {
		const want = viewState(v);
		return LAYER_IDS.every((id) => want[id] === state[id]);
	});
}

/** Reads a saved selection, ignoring anything malformed or unknown. */
export function parseLayerState(raw: string | null): LayerState | null {
	if (!raw) return null;
	try {
		const obj = JSON.parse(raw) as Record<string, unknown>;
		const base = viewState('ops');
		for (const id of LAYER_IDS) if (typeof obj[id] === 'boolean') base[id] = obj[id] as boolean;
		return base;
	} catch {
		return null;
	}
}
