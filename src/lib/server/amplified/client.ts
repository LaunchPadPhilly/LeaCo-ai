import { AmplifiedConfigError, getAmplifiedConfig } from './config.ts';
import {
	MAX_ASSETS_PER_REQUEST,
	MAX_WINDOW_DAYS,
	RATE_LIMIT_PER_MINUTE,
	assetsResponseSchema,
	dataResponseSchema,
	queryModeOf,
	tagsResponseSchema,
	type AssetResult,
	type AssetsResponse,
	type DataRequest,
	type TagsResponse
} from './types.ts';

/**
 * Read-only client for the Amplified Customer API (GET only; the API has no write
 * endpoints). Every failure surfaces as an AmplifiedError whose message is safe to show
 * an MCP client: it never contains the API key or a raw upstream payload.
 */

export type AmplifiedErrorCode =
	| 'NOT_CONFIGURED'
	| 'INVALID_REQUEST'
	| 'UNAUTHORIZED'
	| 'FORBIDDEN'
	| 'RATE_LIMITED'
	| 'UPSTREAM_ERROR'
	| 'TIMEOUT';

export class AmplifiedError extends Error {
	constructor(
		readonly code: AmplifiedErrorCode,
		message: string,
		readonly status?: number
	) {
		super(message);
		this.name = 'AmplifiedError';
	}
}

const REQUEST_TIMEOUT_MS = 20_000;
const TAGS_CACHE_TTL_MS = 10 * 60_000;
const MAX_RETRY_AFTER_MS = 10_000;
const DAY_MS = 86_400_000;

// --- Client-side rate limiting -----------------------------------------------------
// The upstream limit is 100/min per key on /customer_api and /customer_api/assets.
// This counter is per process: the web container's /api/mcp fallback and the mcp
// container each keep their own, so it is a courtesy that prevents one process from
// burning the budget, not a global guarantee. Upstream 429s are still handled below.
const recentRequests: number[] = [];

function takeRateLimitSlot() {
	const now = Date.now();
	while (recentRequests.length && now - recentRequests[0] >= 60_000) recentRequests.shift();
	if (recentRequests.length >= RATE_LIMIT_PER_MINUTE) {
		const retryInSeconds = Math.ceil((60_000 - (now - recentRequests[0])) / 1000);
		throw new AmplifiedError(
			'RATE_LIMITED',
			`Amplified allows ${RATE_LIMIT_PER_MINUTE} requests per minute; try again in about ${retryInSeconds}s.`
		);
	}
	recentRequests.push(now);
}

// --- Transport --------------------------------------------------------------------

async function request(path: string, query: Record<string, string> = {}, rateLimited = true): Promise<unknown> {
	let config;
	try {
		config = getAmplifiedConfig();
	} catch (error) {
		if (error instanceof AmplifiedConfigError) throw new AmplifiedError('NOT_CONFIGURED', error.message);
		throw error;
	}

	const url = new URL(path, config.baseUrl);
	for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

	for (let attempt = 0; ; attempt++) {
		if (rateLimited) takeRateLimitSlot();

		let response: Response;
		try {
			response = await fetch(url, {
				method: 'GET',
				headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
			});
		} catch (error) {
			if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
				throw new AmplifiedError('TIMEOUT', `Amplified did not respond within ${REQUEST_TIMEOUT_MS / 1000}s.`);
			}
			throw new AmplifiedError('UPSTREAM_ERROR', 'Could not reach the Amplified API.');
		}

		if (response.ok) {
			try {
				return await response.json();
			} catch {
				throw new AmplifiedError('UPSTREAM_ERROR', 'Amplified returned a response that is not JSON.', response.status);
			}
		}

		// One retry on 429, honoring Retry-After when it is short enough to wait inside a tool call.
		if (response.status === 429 && attempt === 0) {
			const waitMs = retryAfterMs(response.headers.get('retry-after'));
			if (waitMs !== null && waitMs <= MAX_RETRY_AFTER_MS) {
				await response.body?.cancel();
				await new Promise((resolve) => setTimeout(resolve, waitMs));
				continue;
			}
		}

		throw await toAmplifiedError(response);
	}
}

function retryAfterMs(header: string | null): number | null {
	if (!header) return 2_000;
	const seconds = Number(header);
	if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
	const date = Date.parse(header);
	return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

async function toAmplifiedError(response: Response): Promise<AmplifiedError> {
	const detail = await readDetail(response);
	switch (response.status) {
		case 400:
			return new AmplifiedError('INVALID_REQUEST', detail ?? 'Amplified rejected the request parameters.', 400);
		case 401:
			return new AmplifiedError(
				'UNAUTHORIZED',
				'Amplified rejected the API key: it is incomplete, unknown, or has been deleted. Create a new key under Settings → API Keys.',
				401
			);
		case 403:
			return new AmplifiedError('FORBIDDEN', 'Amplified refused this endpoint for an API key.', 403);
		case 429:
			return new AmplifiedError('RATE_LIMITED', 'Amplified rate limit reached (100 requests/minute); try again shortly.', 429);
		default:
			return new AmplifiedError('UPSTREAM_ERROR', `Amplified returned HTTP ${response.status}.`, response.status);
	}
}

/** The vendor's error body is `{ "detail": "..." }`. Only that short field is surfaced. */
async function readDetail(response: Response): Promise<string | null> {
	try {
		const body = (await response.json()) as { detail?: unknown };
		return typeof body.detail === 'string' ? body.detail.slice(0, 300) : null;
	} catch {
		return null;
	}
}

function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
	const result = schema.safeParse(value);
	if (!result.success) throw new AmplifiedError('UPSTREAM_ERROR', 'Amplified returned a response in an unexpected shape.');
	return result.data;
}

// --- Endpoints --------------------------------------------------------------------

/** GET /customer_api/assets — customer_asset_ids of every well, tank and lease. */
export async function getAssets(): Promise<AssetsResponse> {
	return parse(assetsResponseSchema, await request('/customer_api/assets'));
}

let tagsCache: { at: number; value: TagsResponse } | undefined;

/** GET /customer_api/tags — tag catalogue and per-tag TIME_SERIES limits. Not rate limited upstream; cached 10 min. */
export async function getTags(): Promise<TagsResponse> {
	if (tagsCache && Date.now() - tagsCache.at < TAGS_CACHE_TTL_MS) return tagsCache.value;
	const value = parse(tagsResponseSchema, await request('/customer_api/tags', {}, false));
	tagsCache = { at: Date.now(), value };
	return value;
}

/**
 * GET /customer_api — data for up to any number of assets. Requests above the 20-asset
 * upstream limit are split into sequential batches and merged, so each batch costs one
 * rate-limit slot.
 */
export async function getData(input: DataRequest): Promise<AssetResult[]> {
	validateDataRequest(input);

	const results: AssetResult[] = [];
	for (let i = 0; i < input.assets.length; i += MAX_ASSETS_PER_REQUEST) {
		const batch = { ...input, assets: input.assets.slice(i, i + MAX_ASSETS_PER_REQUEST) };
		const payload = Buffer.from(JSON.stringify(stripUndefined(batch)), 'utf8').toString('base64');
		const response = parse(dataResponseSchema, await request('/customer_api', { payload }));
		results.push(...response.asset_data);
	}
	return results;
}

function validateDataRequest({ assets, start, end }: DataRequest) {
	if (assets.length === 0) throw new AmplifiedError('INVALID_REQUEST', 'Request at least one asset.');
	for (const asset of assets) {
		if (asset.tags.length === 0) {
			throw new AmplifiedError('INVALID_REQUEST', `Asset ${asset.customer_asset_id} has no tags requested.`);
		}
	}
	if (end !== undefined && start === undefined) {
		throw new AmplifiedError('INVALID_REQUEST', '`end` requires `start` (send neither for LATEST, start only for CLOSEST).');
	}
	if (queryModeOf({ start, end }) === 'TIME_SERIES') {
		if (end! <= start!) throw new AmplifiedError('INVALID_REQUEST', '`end` must be after `start`.');
		const days = (end! - start!) / DAY_MS;
		if (days > MAX_WINDOW_DAYS) {
			throw new AmplifiedError(
				'INVALID_REQUEST',
				`TIME_SERIES windows are capped at ${MAX_WINDOW_DAYS} days (requested ${days.toFixed(1)}). Minute-grain tags allow 7 days; split the range.`
			);
		}
	}
}

function stripUndefined<T extends object>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}
