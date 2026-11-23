/**
 * Builds the committed, public-only reference data the dashboard uses wherever LeaCo's private
 * files aren't present (UAT, production):
 *
 *   pnpm run reference:build
 *
 * Reads data/private/ (gitignored) and writes src/lib/leaco/reference/{wells,layers}.json.
 * Only PUBLIC fields are copied: state-record identity and location (NM OCD), and public map
 * layers (U.S. Census TIGER state line and routes, BLM Crawford Ranch outline). Plus each well's
 * Amplified link from the reviewed ID worksheet. Never copied: daily-report volumes, pumper
 * notes, prices, the LeaCo KMZ (Winkler Ranch), or asset-list notes.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const PRIVATE = 'data/private';
const OUT = 'src/lib/leaco/reference';

type KitAsset = { n: string; key: string; k: 'Well' | 'Injector'; ar: string; x: number; y: number; api?: string; sn?: string; op?: string; lt?: string };
const kit = JSON.parse(readFileSync(`${PRIVATE}/combined_data.json`, 'utf8')) as {
	assets: KitAsset[];
	hulls: Record<string, [number, number][]>;
	routes: { a: string; b: string; mi: number; via: [string, number][]; g: [number, number][][] }[];
	rgaps: { a: string; mi: number; g: [number, number][] }[];
};
const state = JSON.parse(readFileSync(`${PRIVATE}/stateline.json`, 'utf8')) as { line: [number, number][][]; tx: { type: string; coordinates: unknown } };
const crawford = JSON.parse(readFileSync(`${PRIVATE}/crawford.json`, 'utf8')) as { crawford: { type: string; coordinates: unknown } };

// ---- Amplified links from the reviewed worksheet
const sheet = readFileSync(`${PRIVATE}/amplified/customer-id-worksheet.csv`, 'utf8').replace(/\r/g, '').trim().split('\n');
const header = sheet[0].split(',');
const col = (n: string) => header.indexOf(n);
const rows = sheet.slice(1).map((line) => {
	const cells: string[] = [];
	let cur = '';
	let q = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (q) {
			if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
			else if (ch === '"') q = false;
			else cur += ch;
		} else if (ch === '"') q = true;
		else if (ch === ',') cells.push(cur), (cur = '');
		else cur += ch;
	}
	cells.push(cur);
	return cells;
});

type Link = { customerAssetId: string; amplifiedId: number | null; status: 'confirmed' | 'probable' | 'conflict'; note: string | null };
const linkByKey = new Map<string, Link>();
for (const r of rows) {
	if (r[col('type')] !== 'well' || !r[col('leaco_well')]) continue;
	const check = r[col('check')].replace(/^CONFIRM:\s*/, '');
	linkByKey.set(r[col('leaco_well')], {
		customerAssetId: r[col('current_customer_asset_id')],
		amplifiedId: Number(r[col('amplified_id')]) || null,
		// "probable": same lease and well number, Amplified just labels the kind differently.
		status: !check ? 'confirmed' : /kind|injector/i.test(check) ? 'probable' : 'conflict',
		note: check || null
	});
}

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
const wells = kit.assets.map((a) => ({
	key: a.key,
	name: a.n,
	kind: a.k === 'Injector' ? 'injector' : 'well',
	area: a.ar,
	lat: r5(a.y),
	lon: r5(a.x),
	api: a.api ?? null,
	stateName: a.sn ?? null,
	operator: a.op ?? null,
	landType: a.lt ?? null,
	amplified: linkByKey.get(a.key) ?? null
}));

const layers = {
	note: 'Public layers only. State line: U.S. Census TIGER. Routes: computed on U.S. Census TIGER roads, not confirmed with LeaCo. Crawford Ranch: BLM NM surface ownership (ownership unconfirmed). Operating-area hulls: drawn around NM OCD well locations (approximate). Winkler Ranch boundary is LeaCo data and is not included.',
	hulls: kit.hulls,
	stateLine: state.line,
	texas: state.tx,
	routes: kit.routes,
	roadGaps: kit.rgaps,
	crawford: crawford.crawford
};

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/wells.json`, JSON.stringify({ source: 'NM OCD state well records (locations approximate); Amplified links from the reviewed ID worksheet', wells }, null, 1) + '\n');
writeFileSync(`${OUT}/layers.json`, JSON.stringify(layers) + '\n');

const counts = { confirmed: 0, probable: 0, conflict: 0, none: 0 };
for (const w of wells) counts[w.amplified?.status ?? 'none']++;
console.log(`wells.json: ${wells.length} wells; Amplified links ${JSON.stringify(counts)}`);
console.log(`layers.json: ${Object.keys(layers.hulls).length} hulls, ${layers.routes.length} routes, ${layers.roadGaps.length} gap, state line, Crawford`);
