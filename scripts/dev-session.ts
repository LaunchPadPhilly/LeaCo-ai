/**
 * Local-only sign-in for automated screenshots (docs/leaco/DASHBOARD-REDESIGN.md §4).
 *
 *   pnpm run dev:session            create a 24-hour session for a test user
 *   pnpm run dev:session --revoke   delete the test user's sessions
 *
 * Playwright can't sign in through Google, so this inserts a session row for a test user
 * straight into the LOCAL database and writes the cookie to .playwright/storage-state.json
 * (gitignored) in Playwright's storage-state format. The token is never printed.
 *
 * Safety: it refuses to run unless DATABASE_URL points at localhost, and when NODE_ENV is
 * production. The test user gets no role and no data scopes, so it can open signed-in pages
 * like /dashboard but not /admin or any MCP data.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import pg from 'pg';

// Like every other loader here: relative to the repository root, loaded before any DB use.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const TEST_EMAIL = 'playwright@localhost.test';
const COOKIE_NAME = 'leaco_session'; // sessionCookieName in src/lib/appConfig.ts
const OUT_DIR = '.playwright';
const OUT_FILE = `${OUT_DIR}/storage-state.json`;
const DAY_MS = 86_400_000;

function fail(message: string): never {
	console.error(`dev-session: ${message}`);
	process.exit(1);
}

if (process.env.NODE_ENV === 'production') fail('refusing to run with NODE_ENV=production.');

const url = process.env.DATABASE_URL;
if (!url) fail('DATABASE_URL is not set (expected in .env.local).');
let host: string;
try {
	host = new URL(url).hostname;
} catch {
	fail('DATABASE_URL is not a valid URL.');
}
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
	fail(`refusing to run: DATABASE_URL host is "${host}", not localhost. This script is for the local Docker database only.`);
}

const revoke = process.argv.includes('--revoke');
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
	const found = await client.query<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [TEST_EMAIL]);
	let userId = found.rows[0]?.id;

	if (revoke) {
		if (userId) await client.query('DELETE FROM "AuthSession" WHERE "userId" = $1', [userId]);
		console.log(`dev-session: revoked sessions for ${TEST_EMAIL}.`);
	} else {
		if (!userId) {
			userId = randomUUID();
			await client.query(
				'INSERT INTO "User" (id, email, "displayName", status, "updatedAt") VALUES ($1, $2, $3, $4, now())',
				[userId, TEST_EMAIL, 'Playwright (local test)', 'ACTIVE']
			);
		}
		const token = randomBytes(32).toString('base64url');
		const tokenHash = createHash('sha256').update(token).digest('hex'); // same as src/lib/server/auth/session.ts
		const expires = new Date(Date.now() + DAY_MS);
		await client.query('INSERT INTO "AuthSession" (id, "userId", "tokenHash", "expiresAt") VALUES ($1, $2, $3, $4)', [
			randomUUID(),
			userId,
			tokenHash,
			expires
		]);

		mkdirSync(OUT_DIR, { recursive: true });
		const state = {
			cookies: [
				{
					name: COOKIE_NAME,
					value: token,
					domain: 'localhost',
					path: '/',
					expires: Math.floor(expires.getTime() / 1000),
					httpOnly: true,
					secure: false,
					sameSite: 'Lax'
				}
			],
			origins: []
		};
		writeFileSync(OUT_FILE, JSON.stringify(state, null, 2));
		console.log(`dev-session: 24-hour session for ${TEST_EMAIL} written to ${OUT_FILE} (token not shown).`);
	}
} finally {
	await client.end();
}
