/**
 * Configuration for the Amplified Customer API connector.
 *
 * Read through `process.env` (never `$env`) because the standalone MCP process imports
 * this module and cannot resolve SvelteKit's virtual env modules. Values are validated
 * on first use and never printed: errors name the variable, not its contents.
 *
 *   AMPLIFIED_API_KEY       required to enable the connector. Company key from the
 *                           Amplified dashboard, Settings → API Keys (`amp_…`, 53 chars).
 *   AMPLIFIED_API_BASE_URL  optional; defaults to the documented production host.
 */

export const DEFAULT_AMPLIFIED_BASE_URL = 'https://flaskapi.acoustic-wells.com';

/** `amp_` + 8-char id + `_` + 40-char secret, letters and digits only (53 chars total). */
const API_KEY_PATTERN = /^amp_[A-Za-z0-9]{8}_[A-Za-z0-9]{40}$/;

export type AmplifiedConfig = {
	apiKey: string;
	baseUrl: string;
	/** First 12 characters (`amp_xxxxxxxx`). Not secret; matches the dashboard's "Key prefix" column. */
	keyPrefix: string;
};

export class AmplifiedConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AmplifiedConfigError';
	}
}

export function isAmplifiedConfigured(): boolean {
	return Boolean(process.env.AMPLIFIED_API_KEY?.trim());
}

let cached: { source: string; config: AmplifiedConfig } | undefined;

export function getAmplifiedConfig(): AmplifiedConfig {
	const apiKey = process.env.AMPLIFIED_API_KEY?.trim() ?? '';
	const rawBaseUrl = process.env.AMPLIFIED_API_BASE_URL?.trim() || DEFAULT_AMPLIFIED_BASE_URL;
	const source = `${apiKey}\n${rawBaseUrl}`;
	if (cached?.source === source) return cached.config;

	if (!apiKey) {
		throw new AmplifiedConfigError('AMPLIFIED_API_KEY is not set; the Amplified connector is disabled.');
	}
	if (!API_KEY_PATTERN.test(apiKey)) {
		throw new AmplifiedConfigError(
			'AMPLIFIED_API_KEY is malformed: expected 53 letters/digits starting with "amp_" (check it was copied in full).'
		);
	}

	let baseUrl: URL;
	try {
		baseUrl = new URL(rawBaseUrl);
	} catch {
		throw new AmplifiedConfigError('AMPLIFIED_API_BASE_URL is not a valid URL.');
	}
	if (baseUrl.protocol !== 'https:') {
		throw new AmplifiedConfigError('AMPLIFIED_API_BASE_URL must use https; the API key is sent on every request.');
	}

	const config: AmplifiedConfig = {
		apiKey,
		baseUrl: baseUrl.origin,
		keyPrefix: apiKey.slice(0, 12)
	};
	cached = { source, config };
	return config;
}
