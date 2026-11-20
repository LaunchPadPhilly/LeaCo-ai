import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Visual checks for the LeaCo dashboard (docs/leaco/DASHBOARD-REDESIGN.md §4). Local only:
 * run `pnpm run dev:session` first to create the signed-in storage state, then
 * `pnpm run test:e2e`. Reuses a running `pnpm dev`, or starts one.
 */
const storageState = '.playwright/storage-state.json';

export default defineConfig({
	testDir: 'tests/e2e',
	outputDir: '.playwright/results',
	reporter: [['list']],
	use: {
		baseURL: 'http://localhost:5173',
		storageState: existsSync(storageState) ? storageState : undefined,
		trace: 'off'
	},
	webServer: {
		command: 'pnpm dev',
		url: 'http://localhost:5173/api/health',
		reuseExistingServer: true,
		timeout: 120_000
	},
	projects: [
		{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
		{ name: 'phone', use: { ...devices['Desktop Chrome'], viewport: { width: 380, height: 800 }, hasTouch: true, isMobile: true } }
	]
});
