import type { LonLat, PropertyKey } from './types';

/**
 * Fixed facts about each LeaCo property, carried over from the prototype with their
 * sources. Anything unconfirmed says so; see docs/leaco/open-questions.md.
 */
export type Property = {
	key: PropertyKey;
	name: string;
	near: string;
	kind: 'operating' | 'land';
	/** Caveat shown on the card (operator of record, confidence). */
	warn: string | null;
	facts: [string, string][];
	/** Map extent for "Go to"; operating areas use their hull instead. */
	bounds?: [LonLat, LonLat];
	source: string;
};

export const PROPERTIES: Record<PropertyKey, Property> = {
	mlmu: {
		key: 'mlmu',
		name: 'Myers Langlie Mattix',
		near: 'near Jal, NM',
		kind: 'operating',
		warn: 'State records list J R Oil, Ltd. Co. as operator.',
		facts: [],
		source: 'LeaCo Daily Reports; NM OCD'
	},
	eeu: {
		key: 'eeu',
		name: 'East Eumont',
		near: 'near Eunice, NM',
		kind: 'operating',
		warn: 'State records list J R Oil, Ltd. Co. as operator.',
		facts: [],
		source: 'LeaCo Daily Reports; NM OCD'
	},
	rw: {
		key: 'rw',
		name: 'Rhodes & Wills',
		near: 'NM–TX line',
		kind: 'operating',
		warn: null,
		facts: [],
		source: 'LeaCo Daily Reports; NM OCD'
	},
	winkler: {
		key: 'winkler',
		name: 'Winkler Ranch',
		near: 'Winkler Co., TX',
		kind: 'land',
		warn: null,
		facts: [
			['What it is', 'Owned land, planned water disposal under the XRI deal'],
			['Size', '1,933.45 ac per deed (Doc. C39760). LeaCo’s map file labels the boundary 1,929.5 ac.'],
			['Disposal permits', '3 approved, not drilled'],
			['Oncor 345 kV', 'Condemnation pending. Oncor’s survey: 160 ft / 50.625 ac; LeaCo’s map file draws 238 ft.'],
			['Access', 'No mapped public road for the last ~1.1 mi (open question)']
		],
		bounds: [
			[-103.235, 31.965],
			[-103.18, 32.003]
		],
		source: 'LeaCo KMZ; deed Doc. C39760; Oncor survey'
	},
	crawford: {
		key: 'crawford',
		name: 'Crawford Ranch',
		near: 'Lea Co., NM',
		kind: 'land',
		warn: 'Ownership and current use unconfirmed.',
		facts: [
			['Size', '~2,400 ac; private surface per BLM'],
			['Plan', 'XRI disposal wells; $0.13 per bbl disposed'],
			['Permits', 'Pending with NM OCD (Dec 2025)']
		],
		bounds: [
			[-103.3, 32.235],
			[-103.258, 32.286]
		],
		source: 'BLM NM surface ownership; XRI Water Services Agreement'
	}
};

export const AREA_KEYS = ['mlmu', 'eeu', 'rw'] as const;
export const PROPERTY_KEYS = ['mlmu', 'eeu', 'rw', 'winkler', 'crawford'] as const;

/** XRI's supply water delivery point (XRI Water Services Agreement, Annex I). */
export const DELIVERY_POINT: LonLat = [-103.147715, 32.017132];
