/**
 * Read-only look at what the Amplified Customer API returns for LeaCo, to design the sync
 * (docs/leaco/PLAN.md §2a). GET requests only; the API has no write endpoints.
 *
 *   pnpm run amplified:probe
 *
 * Saves the raw responses to data/private/amplified/ (gitignored: LeaCo business data) and
 * prints a summary. The API key is read from .env.local and never printed.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const { getAssets, getTags, getData, AmplifiedError } = await import('../src/lib/server/amplified/client.ts');

const OUT = 'data/private/amplified';
mkdirSync(OUT, { recursive: true });
const save = (name: string, value: unknown) => writeFileSync(`${OUT}/${name}.json`, JSON.stringify(value, null, 2));

function describe(value: unknown): string {
	if (value === null || value === undefined) return String(value);
	const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
	return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

try {
	const assets = await getAssets();
	save('assets', assets);
	console.log(`Assets: ${assets.wells.length} wells, ${assets.tanks.length} tanks, ${assets.leases.length} leases`);
	console.log(`  well id examples:  ${assets.wells.slice(0, 6).join(', ')}`);
	console.log(`  injector-looking:  ${assets.wells.filter((w) => /INJ/i.test(w)).length} ids end in INJ`);
	console.log(`  lease ids:         ${assets.leases.join(', ')}`);

	const tags = await getTags();
	save('tags', tags);
	console.log(`\nWell tags (${tags.well_tags.length}): ${tags.well_tags.join(', ')}`);
	console.log(`Tank tags (${tags.tank_tags.length}): ${tags.tank_tags.join(', ')}`);
	console.log(`Lease tags (${tags.lease_tags.length}): ${tags.lease_tags.join(', ')}`);

	const injector = assets.wells.find((w) => /INJ/i.test(w));
	const producer = assets.wells.find((w) => /PRD/i.test(w));
	const lease = assets.leases[0];
	const requests = [
		...(injector ? [{ type: 'well' as const, customer_asset_id: injector, tags: tags.well_tags }] : []),
		...(producer ? [{ type: 'well' as const, customer_asset_id: producer, tags: tags.well_tags }] : []),
		...(lease ? [{ type: 'lease' as const, customer_asset_id: lease, tags: tags.lease_tags }] : [])
	];
	const latest = await getData({ assets: requests });
	save('latest-sample', latest);
	for (const a of latest) {
		console.log(`\nLATEST ${a.metadata.customer_asset_id} (${a.metadata.asset_name ?? 'no name'}, Amplified ${a.metadata.amplified_id ?? '?'})`);
		for (const [tag, d] of Object.entries(a.data)) {
			console.log(`  ${tag.padEnd(26)} ${describe(d.value).padEnd(30)} ${d.unit ?? ''} ${d.timestamp ?? ''}`);
		}
		if (a.errors.length) console.log(`  errors: ${a.errors.join(' | ')}`);
	}
	console.log(`\nSaved raw responses to ${OUT}/ (gitignored).`);
} catch (err) {
	if (err instanceof AmplifiedError) {
		console.error(`Amplified ${err.code}: ${err.message}`);
		process.exit(1);
	}
	throw err;
}
