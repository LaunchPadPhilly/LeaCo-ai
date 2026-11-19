import { z } from 'zod';

/**
 * Request and response shapes for the Amplified Customer API, from the vendor's
 * "Customer API - Technical Documentation". Response schemas are deliberately loose
 * (`.passthrough()` / `unknown` values): the vendor documents several fields as additive,
 * so new tags or fields must not break parsing.
 */

export const assetTypes = ['well', 'tank', 'lease'] as const;
export type AssetType = (typeof assetTypes)[number];

/** Documented upstream limits. */
export const MAX_ASSETS_PER_REQUEST = 20;
export const MAX_WINDOW_DAYS = 1098;
export const RATE_LIMIT_PER_MINUTE = 100;

export const assetsResponseSchema = z
	.object({
		wells: z.array(z.string()).default([]),
		tanks: z.array(z.string()).default([]),
		leases: z.array(z.string()).default([])
	})
	.passthrough();
export type AssetsResponse = z.infer<typeof assetsResponseSchema>;

const tagLimitSchema = z
	.object({
		grain: z.string(),
		max_window_days: z.number()
	})
	.passthrough();

export const tagsResponseSchema = z
	.object({
		well_tags: z.array(z.string()).default([]),
		tank_tags: z.array(z.string()).default([]),
		lease_tags: z.array(z.string()).default([]),
		tag_limits: z.record(z.string(), z.record(z.string(), tagLimitSchema)).default({})
	})
	.passthrough();
export type TagsResponse = z.infer<typeof tagsResponseSchema>;

const pointSchema = z
	.object({
		value: z.unknown().optional(),
		timestamp: z.string().nullable().optional(),
		quality: z.string().optional()
	})
	.passthrough();

/** One tag's result: a single point (`value`) or a series (`values`). */
const tagDataSchema = pointSchema.extend({
	unit: z.string().optional(),
	values: z.array(pointSchema).optional()
});
export type TagData = z.infer<typeof tagDataSchema>;

const assetResultSchema = z
	.object({
		metadata: z
			.object({
				customer_asset_id: z.string().nullable().optional(),
				amplified_id: z.number().nullable().optional(),
				asset_name: z.string().nullable().optional(),
				lease_name: z.string().nullable().optional()
			})
			.passthrough(),
		data: z.record(z.string(), tagDataSchema).default({}),
		errors: z.array(z.string()).default([])
	})
	.passthrough();
export type AssetResult = z.infer<typeof assetResultSchema>;

export const dataResponseSchema = z
	.object({
		asset_data: z.array(assetResultSchema).default([])
	})
	.passthrough();

export type AssetRequest = {
	type: AssetType;
	customer_asset_id: string;
	tags: string[];
	/** Only meaningful for tank level/gauge tags; the API defaults to feet. */
	unit?: 'inch';
};

export type DataRequest = {
	assets: AssetRequest[];
	/** Epoch milliseconds. Omit both for LATEST; `start` alone for CLOSEST; both for TIME_SERIES. */
	start?: number;
	end?: number;
};

export type QueryMode = 'LATEST' | 'CLOSEST' | 'TIME_SERIES';

export function queryModeOf(request: Pick<DataRequest, 'start' | 'end'>): QueryMode {
	if (request.start === undefined) return 'LATEST';
	return request.end === undefined ? 'CLOSEST' : 'TIME_SERIES';
}
