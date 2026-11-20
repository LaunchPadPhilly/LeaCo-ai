import { z } from 'zod';
import type { McpToolDefinition } from '$lib/server/mcp/handler';
import { downsample, fieldNames, findAssets, leaseProduction, tankActivity, wellHealth } from './analytics.ts';
import { AmplifiedError, getAssets, getData, getTags } from './client.ts';
import { isAmplifiedConfigured } from './config.ts';
import { assetTypes, queryModeOf, type AssetResult, type TagData } from './types.ts';

/**
 * MCP tools over the Amplified Customer API. All are read-only (the upstream API has
 * only GET endpoints) and gated by DATA_READ like the rest of the data tools.
 *
 * The shared handler turns a thrown error into a generic "data unavailable" message, so
 * expected failures (not configured, bad window, rate limited, revoked key) are returned
 * as `{ error: { code, message } }` instead, letting the client explain what happened.
 */

const DEFAULT_MAX_POINTS_PER_TAG = 500;

/** Keeps the handler's input typed from its own shape, then widens for the shared list. */
function defineTool<Shape extends z.ZodRawShape>(tool: McpToolDefinition<Shape>): McpToolDefinition {
	return tool as unknown as McpToolDefinition;
}

async function safely<T>(operation: () => Promise<T>) {
	if (!isAmplifiedConfigured()) {
		return {
			error: {
				code: 'NOT_CONFIGURED',
				message: 'The Amplified connector is not configured in this environment (AMPLIFIED_API_KEY is unset).'
			}
		};
	}
	try {
		return await operation();
	} catch (error) {
		if (error instanceof AmplifiedError) return { error: { code: error.code, message: error.message } };
		throw error;
	}
}

/** Accepts epoch milliseconds or an ISO-8601 string; the upstream API only takes epoch ms. */
const timestampInput = z
	.union([z.number().int().nonnegative(), z.iso.datetime({ offset: true })])
	.transform((value) => (typeof value === 'number' ? value : Date.parse(value)));

const fieldInput = z
	.enum(fieldNames as [string, ...string[]])
	.optional()
	.describe(`Limit to one field (lease group): ${fieldNames.join(', ')}.`);

function truncateSeries(tag: TagData, maxPoints: number) {
	if (!tag.values || tag.values.length <= maxPoints) return tag;
	return { ...tag, values: tag.values.slice(0, maxPoints), truncated: true, totalPoints: tag.values.length };
}

function shapeAsset(asset: AssetResult, maxPoints: number, interval: 'raw' | 'hour' | 'day') {
	return {
		...asset,
		data: Object.fromEntries(
			Object.entries(asset.data).map(([name, tag]) => [
				name,
				interval === 'raw' ? truncateSeries(tag, maxPoints) : downsample(tag, interval)
			])
		)
	};
}

export const amplifiedTools: readonly McpToolDefinition[] = [
	defineTool({
		name: 'amplified_find_assets',
		description:
			'Finds Amplified wells, injectors, tanks and leases by name, and returns their exact customer_asset_id for the other amplified_* tools. ' +
			'Matching ignores case and punctuation; numbers match exactly ("13" does not match "130"). ' +
			'Understands MLMU (Myers Langlie Mattix Unit) and EEU (East Eumont Unit). ' +
			"Examples: 'East Eumont Unit 13' → { query: \"east eumont 13\" }; 'all MLMU injectors' → { query: \"mlmu\", kind: \"injector\" }; " +
			"'which tanks are on Rhodes?' → { kind: \"tank\", field: \"Rhodes\" }.",
		inputSchema: {
			query: z.string().trim().max(200).optional().describe('Name or part of a name, e.g. "MLMU #204" or "east eumont tank".'),
			kind: z.enum(['producer', 'injector', 'tank', 'lease']).optional(),
			field: fieldInput
		},
		requiredScope: 'DATA_READ',
		handler: async (input) => safely(() => findAssets(input))
	}),
	defineTool({
		name: 'amplified_assets',
		description:
			'Lists the customer_asset_id of every well, tank and lease available from Amplified (oilfield telemetry). ' +
			'Prefer amplified_find_assets to look up specific assets. ' +
			'Returns { wells: string[], tanks: string[], leases: string[] }.',
		inputSchema: {},
		requiredScope: 'DATA_READ',
		handler: async () => safely(getAssets)
	}),
	defineTool({
		name: 'amplified_tags',
		description:
			'Lists the Amplified tags available per asset type (well_tags, tank_tags, lease_tags) and tag_limits: ' +
			"each tag's sampling grain and max TIME_SERIES window in days (minute grain = 7 days, daily/event = 1098). " +
			'Note: daily_runtime, daily_cycles, well_run_status, last_connection, high_level and high_high_level answer LATEST only; ' +
			'dynacard answers LATEST and CLOSEST only, whatever tag_limits says. There is no injection-volume tag.',
		inputSchema: {},
		requiredScope: 'DATA_READ',
		handler: async () => safely(getTags)
	}),
	defineTool({
		name: 'amplified_lease_production',
		description:
			'Daily oil and own produced water per lease, in the shape of LeaCo\'s daily report: yesterday, prior day, % change, ' +
			'7-day average, month-to-date total and average, and 30-day total, plus a total row. ' +
			'groupBy "field" (default) rolls the 11 Amplified leases into fields (Myers Langlie Mattix, East Eumont, Mr Wills Federal, ' +
			'Wills Federal, Mary E Wills A Federal, Rhodes); "lease" keeps each Amplified lease separate. ' +
			'Oil is per lease only: Amplified has no per-well production. Injected water is not available from this API. ' +
			"Example: 'how much oil did we make yesterday and this month?' → {}.",
		inputSchema: {
			reportDate: z.iso
				.date()
				.optional()
				.describe('Report date YYYY-MM-DD (UTC); "yesterday" is the day before. Defaults to today.'),
			groupBy: z.enum(['field', 'lease']).optional()
		},
		requiredScope: 'DATA_READ',
		handler: async ({ reportDate, groupBy = 'field' }) =>
			safely(() =>
				leaseProduction({ reportDate: reportDate ? Date.parse(`${reportDate}T00:00:00Z`) : undefined, groupBy })
			)
	}),
	defineTool({
		name: 'amplified_well_health',
		description:
			'One-call fleet check across every Amplified well: which producers are running, idle, shut down or offline ' +
			'(no report for more than staleHours), yesterday\'s runtime %, wells that ran yesterday (comparable to the daily ' +
			'report\'s "wells running"), low-runtime wells, and which injector devices are reporting. ' +
			'Set includeTickets for open tickets per well (slower). Rows are sorted worst first. ' +
			"Examples: 'which wells are down?' → {}; 'any East Eumont wells offline?' → { field: \"East Eumont\" }.",
		inputSchema: {
			field: fieldInput,
			staleHours: z.number().min(1).max(720).optional().describe('Hours without a report before a device counts as offline. Default 24.'),
			lowRuntimePct: z.number().min(1).max(100).optional().describe('Runtime % below which a running well is listed as low. Default 10.'),
			includeTickets: z.boolean().optional()
		},
		requiredScope: 'DATA_READ',
		handler: async ({ field, staleHours = 24, lowRuntimePct = 10, includeTickets = false }) =>
			safely(() => wellHealth({ field, staleHours, lowRuntimePct, includeTickets }))
	}),
	defineTool({
		name: 'amplified_tank_activity',
		description:
			'Every tank over the last N hours: current volume and level, change in volume, filed pickups (run tickets with ' +
			'volume and fluid), BS&W cleanings, and gauges that have stopped reporting. ' +
			"Examples: 'any oil pickups today?' → { hours: 24 }; 'which tank gauges are offline?' → {}.",
		inputSchema: {
			hours: z.number().min(1).max(168).optional().describe('Window length in hours (max 7 days). Default 24.'),
			staleHours: z.number().min(1).max(720).optional().describe('Hours without a gauge report before it counts as stale. Default 24.')
		},
		requiredScope: 'DATA_READ',
		handler: async ({ hours = 24, staleHours = 24 }) => safely(() => tankActivity({ hours, staleHours }))
	}),
	defineTool({
		name: 'amplified_data',
		description:
			'Reads well, tank and lease data from Amplified by customer_asset_id (use amplified_find_assets to get ids). ' +
			'Mode follows the time arguments: neither start nor end = LATEST (most recent value per tag); ' +
			'start only = CLOSEST (point nearest that instant; for lease tags, the UTC day containing it); ' +
			'start and end = TIME_SERIES (all points in the window, limited per tag — see amplified_tags). ' +
			'For trends, set interval "hour" or "day" to get {avg,min,max,count} buckets instead of raw minute points. ' +
			"A tag that cannot serve the request appears in that asset's errors array while other tags are still returned. " +
			'Lease daily_oil_production/daily_water_production already include the tank run tickets: never add the two together. ' +
			'A day with no value is absent, not zero. All timestamps are UTC. ' +
			"Example: 'tubing pressure on WELL-A1-001 over the last week, hourly' → " +
			'{ assets: [{ type: "well", customer_asset_id: "WELL-A1-001", tags: ["tubing_pressure"] }], start: "<ISO now-7d>", end: "<ISO now>", interval: "hour" }. ' +
			'Returns { mode, assets: [{ metadata, data, errors }] }.',
		inputSchema: {
			assets: z
				.array(
					z.object({
						type: z.enum(assetTypes),
						customer_asset_id: z.string().trim().min(1).max(200),
						tags: z.array(z.string().trim().min(1).max(100)).min(1).max(30),
						unit: z.enum(['inch', 'ft']).optional().describe('Tank level/gauge tags only. Defaults to ft.')
					})
				)
				.min(1)
				.max(60)
				.describe('Assets to read. More than 20 are split into several upstream requests.'),
			start: timestampInput.optional().describe('Epoch milliseconds or ISO-8601 with offset (e.g. 2026-01-15T10:30:00Z).'),
			end: timestampInput.optional().describe('Epoch milliseconds or ISO-8601 with offset. Requires start.'),
			interval: z
				.enum(['raw', 'hour', 'day'])
				.optional()
				.describe('TIME_SERIES only: "hour"/"day" return {avg,min,max,count} buckets. Default raw.'),
			maxPointsPerTag: z
				.number()
				.int()
				.min(1)
				.max(10_000)
				.optional()
				.describe(`Raw mode only: caps each series to keep responses small. Default ${DEFAULT_MAX_POINTS_PER_TAG}.`)
		},
		requiredScope: 'DATA_READ',
		handler: async ({ assets, start, end, interval = 'raw', maxPointsPerTag = DEFAULT_MAX_POINTS_PER_TAG }) =>
			safely(async () => {
				const results = await getData({
					// `ft` is the upstream default, so only `inch` is sent.
					assets: assets.map(({ unit, ...asset }) => (unit === 'inch' ? { ...asset, unit } : asset)),
					start,
					end
				});
				return {
					mode: queryModeOf({ start, end }),
					timezone: 'UTC',
					assets: results.map((asset) => shapeAsset(asset, maxPointsPerTag, interval))
				};
			})
	})
];
