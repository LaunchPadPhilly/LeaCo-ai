import { z } from 'zod';
import type { McpToolDefinition } from '$lib/server/mcp/handler';
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
	try {
		return await operation();
	} catch (error) {
		if (error instanceof AmplifiedError) return { error: { code: error.code, message: error.message } };
		throw error;
	}
}

function notConfigured() {
	return {
		error: {
			code: 'NOT_CONFIGURED',
			message: 'The Amplified connector is not configured in this environment (AMPLIFIED_API_KEY is unset).'
		}
	};
}

/** Accepts epoch milliseconds or an ISO-8601 string; the upstream API only takes epoch ms. */
const timestampInput = z
	.union([z.number().int().nonnegative(), z.iso.datetime({ offset: true })])
	.transform((value) => (typeof value === 'number' ? value : Date.parse(value)));

function truncateSeries(tag: TagData, maxPoints: number) {
	if (!tag.values || tag.values.length <= maxPoints) return tag;
	return { ...tag, values: tag.values.slice(0, maxPoints), truncated: true, totalPoints: tag.values.length };
}

function shapeAsset(asset: AssetResult, maxPoints: number) {
	return {
		...asset,
		data: Object.fromEntries(Object.entries(asset.data).map(([name, tag]) => [name, truncateSeries(tag, maxPoints)]))
	};
}

export const amplifiedTools: readonly McpToolDefinition[] = [
	{
		name: 'amplified_assets',
		description:
			'Lists the customer_asset_id of every well, tank and lease available from Amplified (oilfield telemetry). ' +
			'Call this first to find valid ids for amplified_data. ' +
			"Example question: 'which wells do we have in Amplified?' → {}. " +
			'Returns { wells: string[], tanks: string[], leases: string[] }.',
		inputSchema: {},
		requiredScope: 'DATA_READ',
		handler: async () => (isAmplifiedConfigured() ? safely(getAssets) : notConfigured())
	},
	{
		name: 'amplified_tags',
		description:
			'Lists the Amplified tags available per asset type (well_tags, tank_tags, lease_tags) and tag_limits: ' +
			'each tag\'s sampling grain and max TIME_SERIES window in days (minute grain = 7 days, daily/event = 1098). ' +
			'Note: daily_runtime, daily_cycles, well_run_status, last_connection, high_level and high_high_level answer LATEST only; ' +
			'dynacard answers LATEST and CLOSEST only, whatever tag_limits says.',
		inputSchema: {},
		requiredScope: 'DATA_READ',
		handler: async () => (isAmplifiedConfigured() ? safely(getTags) : notConfigured())
	},
	defineTool({
		name: 'amplified_data',
		description:
			'Reads well, tank and lease data from Amplified by customer_asset_id. ' +
			'Mode follows the time arguments: neither start nor end = LATEST (most recent value per tag); ' +
			'start only = CLOSEST (point nearest that instant; for lease tags, the UTC day containing it); ' +
			'start and end = TIME_SERIES (all points in the window, limited per tag — see amplified_tags). ' +
			'A tag that cannot serve the request appears in that asset\'s errors array while other tags are still returned. ' +
			'Lease daily_oil_production/daily_water_production already include the tank run tickets: never add the two together. ' +
			'A day with no value is absent, not zero. ' +
			"Example: 'tubing pressure on WELL-A1-001 over the last day' → " +
			'{ assets: [{ type: "well", customer_asset_id: "WELL-A1-001", tags: ["tubing_pressure"] }], start: "<ISO now-24h>", end: "<ISO now>" }. ' +
			'Returns { mode, assets: [{ metadata, data, errors }] }.',
		inputSchema: {
			assets: z
				.array(
					z.object({
						type: z.enum(assetTypes),
						customer_asset_id: z.string().trim().min(1).max(200),
						tags: z.array(z.string().trim().min(1).max(100)).min(1).max(30),
						unit: z
							.enum(['inch', 'ft'])
							.optional()
							.describe('Tank level/gauge tags only. Defaults to ft.')
					})
				)
				.min(1)
				.max(60)
				.describe('Assets to read. More than 20 are split into several upstream requests.'),
			start: timestampInput.optional().describe('Epoch milliseconds or ISO-8601 with offset (e.g. 2026-01-15T10:30:00Z).'),
			end: timestampInput.optional().describe('Epoch milliseconds or ISO-8601 with offset. Requires start.'),
			maxPointsPerTag: z
				.number()
				.int()
				.min(1)
				.max(10_000)
				.optional()
				.describe(`Caps each time series (newest first) to keep responses small. Default ${DEFAULT_MAX_POINTS_PER_TAG}.`)
		},
		requiredScope: 'DATA_READ',
		handler: async ({ assets, start, end, maxPointsPerTag = DEFAULT_MAX_POINTS_PER_TAG }) => {
			if (!isAmplifiedConfigured()) return notConfigured();
			return safely(async () => {
				const results = await getData({
					// `ft` is the upstream default, so only `inch` is sent.
					assets: assets.map(({ unit, ...asset }) => (unit === 'inch' ? { ...asset, unit } : asset)),
					start,
					end
				});
				return {
					mode: queryModeOf({ start, end }),
					assets: results.map((asset) => shapeAsset(asset, maxPointsPerTag))
				};
			});
		}
	})
];
