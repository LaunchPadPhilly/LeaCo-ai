import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Read-only Dropbox client for the document source (Play 03b, ADR 0003).
 *
 * The app holds only files.metadata.read, files.content.read and account_info.read, so even a
 * bug here cannot change anything in Dropbox. Credentials come from process.env (never `$env`,
 * so the standalone MCP process and scripts can use this too) and never appear in an error
 * message or log line.
 */

const API = 'https://api.dropboxapi.com';
const CONTENT = 'https://content.dropboxapi.com';
const REQUEST_TIMEOUT_MS = 30_000;
/** Downloads stream to disk, so a large file only needs time, not memory, while it transfers. */
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

export type DropboxErrorCode = 'NOT_CONFIGURED' | 'AUTH_FAILED' | 'NOT_FOUND' | 'RATE_LIMITED' | 'UPSTREAM_ERROR' | 'TIMEOUT';

export class DropboxError extends Error {
	constructor(
		readonly code: DropboxErrorCode,
		message: string
	) {
		super(message);
		this.name = 'DropboxError';
	}
}

type DropboxConfig = {
	appKey: string;
	appSecret: string;
	refreshToken: string;
	rootFolderId: string;
	/** Team-space namespace; empty when the folder is not in a team space. */
	pathRootNamespaceId: string;
};

const REQUIRED = ['DROPBOX_APP_KEY', 'DROPBOX_APP_SECRET', 'DROPBOX_REFRESH_TOKEN', 'DROPBOX_ROOT_FOLDER_ID'] as const;

function readEnv(name: string) {
	return (process.env[name] ?? '').trim();
}

export function isDropboxConfigured() {
	return REQUIRED.every((name) => readEnv(name) !== '');
}

function getConfig(): DropboxConfig {
	const missing = REQUIRED.filter((name) => readEnv(name) === '');
	if (missing.length) {
		throw new DropboxError('NOT_CONFIGURED', `The Dropbox document source is not configured (missing ${missing.join(', ')}).`);
	}
	const rootFolderId = readEnv('DROPBOX_ROOT_FOLDER_ID');
	if (!rootFolderId.startsWith('id:')) {
		throw new DropboxError('NOT_CONFIGURED', 'DROPBOX_ROOT_FOLDER_ID must be a Dropbox folder id (id:...), as printed by `dropbox-auth.sh verify`.');
	}
	return {
		appKey: readEnv('DROPBOX_APP_KEY'),
		appSecret: readEnv('DROPBOX_APP_SECRET'),
		refreshToken: readEnv('DROPBOX_REFRESH_TOKEN'),
		rootFolderId,
		pathRootNamespaceId: readEnv('DROPBOX_PATH_ROOT_NAMESPACE_ID')
	};
}

// --- Access token -----------------------------------------------------------------

let cachedToken: { value: string; expiresAt: number } | undefined;

async function accessToken(config: DropboxConfig): Promise<string> {
	if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.value;

	const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: config.refreshToken });
	const response = await send(`${API}/oauth2/token`, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${Buffer.from(`${config.appKey}:${config.appSecret}`).toString('base64')}`,
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body
	});
	if (!response.ok) {
		const error = await safeJson<{ error?: string }>(response);
		throw new DropboxError(
			'AUTH_FAILED',
			error?.error === 'invalid_grant'
				? 'Dropbox rejected the refresh token (revoked or app unlinked). Re-issue it with Play 03b step 4.'
				: `Dropbox token refresh failed (HTTP ${response.status}${error?.error ? `, ${error.error}` : ''}).`
		);
	}
	const json = await response.json() as { access_token: string; expires_in: number };
	cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
	return cachedToken.value;
}

// --- Transport --------------------------------------------------------------------

async function send(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
	try {
		return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
	} catch (error) {
		if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
			throw new DropboxError('TIMEOUT', `Dropbox did not respond within ${Math.round(timeoutMs / 1000)}s.`);
		}
		throw new DropboxError('UPSTREAM_ERROR', 'Could not reach Dropbox.');
	}
}

async function safeJson<T>(response: Response): Promise<T | null> {
	try {
		return (await response.json()) as T;
	} catch {
		return null;
	}
}

function pathRootHeader(config: DropboxConfig): Record<string, string> {
	return config.pathRootNamespaceId
		? { 'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: config.pathRootNamespaceId }) }
		: {};
}

/** Dropbox-API-Arg must be ASCII; non-ASCII characters go as \uXXXX escapes. */
function apiArg(value: unknown) {
	return JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

async function toError(response: Response, what: string): Promise<DropboxError> {
	const body = await safeJson<{ error_summary?: string }>(response);
	const summary = body?.error_summary ?? '';
	if (response.status === 401) return new DropboxError('AUTH_FAILED', `Dropbox refused the access token while ${what}.`);
	if (response.status === 429) return new DropboxError('RATE_LIMITED', `Dropbox rate limit reached while ${what}; try again shortly.`);
	if (/not_found/.test(summary)) return new DropboxError('NOT_FOUND', `Dropbox could not find the item while ${what}.`);
	// error_summary is a short machine tag (e.g. "path/malformed_path/"), never file content.
	return new DropboxError('UPSTREAM_ERROR', `Dropbox returned HTTP ${response.status} while ${what}${summary ? ` (${summary.slice(0, 80)})` : ''}.`);
}

async function rpc<T>(endpoint: string, body: unknown, what: string): Promise<T> {
	const config = getConfig();
	const token = await accessToken(config);
	const response = await send(`${API}${endpoint}`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...pathRootHeader(config) },
		body: JSON.stringify(body)
	});
	if (!response.ok) throw await toError(response, what);
	return (await response.json()) as T;
}

// --- Endpoints --------------------------------------------------------------------

export type DropboxFile = {
	id: string;
	name: string;
	/** Full path in the token account's Dropbox, display case. */
	pathDisplay: string;
	pathLower: string;
	size: number;
	contentHash: string | null;
	serverModified: string;
};

type RawEntry = {
	'.tag': 'file' | 'folder' | 'deleted';
	id?: string;
	name: string;
	path_display?: string;
	path_lower?: string;
	size?: number;
	content_hash?: string;
	server_modified?: string;
	is_downloadable?: boolean;
};

export type DropboxRoot = { id: string; pathDisplay: string; pathLower: string };

/** The configured root folder, resolved by id so a rename or move does not break it. */
export async function getRoot(): Promise<DropboxRoot> {
	const config = getConfig();
	const meta = await rpc<RawEntry>('/2/files/get_metadata', { path: config.rootFolderId }, 'resolving the root folder');
	if (meta['.tag'] !== 'folder') throw new DropboxError('NOT_FOUND', 'DROPBOX_ROOT_FOLDER_ID does not point at a folder.');
	return { id: meta.id!, pathDisplay: meta.path_display ?? '', pathLower: meta.path_lower ?? '' };
}

/** Every file under the root, recursively. Folders are implied by file paths. */
export async function listAllFiles(): Promise<DropboxFile[]> {
	const config = getConfig();
	const files: DropboxFile[] = [];
	let page = await rpc<{ entries: RawEntry[]; cursor: string; has_more: boolean }>(
		'/2/files/list_folder',
		{ path: config.rootFolderId, recursive: true, include_deleted: false, limit: 2000 },
		'listing the folder'
	);
	for (;;) {
		for (const entry of page.entries) {
			// Google Docs/Sheets and other cloud-only files are not downloadable as files.
			if (entry['.tag'] !== 'file' || entry.is_downloadable === false || !entry.id) continue;
			files.push({
				id: entry.id,
				name: entry.name,
				pathDisplay: entry.path_display ?? entry.name,
				pathLower: entry.path_lower ?? entry.name.toLowerCase(),
				size: entry.size ?? 0,
				contentHash: entry.content_hash ?? null,
				serverModified: entry.server_modified ?? ''
			});
		}
		if (!page.has_more) break;
		page = await rpc('/2/files/list_folder/continue', { cursor: page.cursor }, 'listing the folder');
	}
	return files;
}

/** Streams one file to `destination` on disk. */
export async function downloadToFile(fileId: string, destination: string): Promise<void> {
	const config = getConfig();
	const token = await accessToken(config);
	const response = await send(
		`${CONTENT}/2/files/download`,
		{
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': apiArg({ path: fileId }), ...pathRootHeader(config) }
		},
		DOWNLOAD_TIMEOUT_MS
	);
	if (!response.ok || !response.body) throw await toError(response, 'downloading a file');
	await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(destination, { mode: 0o600 }));
}
