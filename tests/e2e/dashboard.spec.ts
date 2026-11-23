import { expect, test } from '@playwright/test';

/**
 * Renders /dashboard signed in (local test session), fails on any console error, and saves
 * screenshots to .playwright/screenshots/ for review.
 */
test('dashboard renders the rail and map without console errors', async ({ page }, info) => {
	const errors: string[] = [];
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text());
	});
	page.on('pageerror', (e) => errors.push(e.message));

	const res = await page.goto('/dashboard');
	expect(page.url(), 'redirected to sign-in: run `pnpm run dev:session` first').toContain('/dashboard');
	expect(res?.status()).toBe(200);

	await expect(page.getByRole('heading', { name: 'Field sheet' })).toBeVisible();
	await expect(page.getByRole('list', { name: 'Headline numbers' })).toContainText('Water injected');
	await expect(page.getByRole('application')).toBeVisible();
	await page.waitForTimeout(800); // let the initial fit settle
	await page.screenshot({ path: `.playwright/screenshots/${info.project.name}-01-overview.png` });

	// Select a property, then open an injector from the attention list.
	await page.getByRole('button', { name: 'Show Myers Langlie Mattix on the map' }).click();
	await page.waitForTimeout(900);
	await page.screenshot({ path: `.playwright/screenshots/${info.project.name}-02-mlmu.png` });

	await page.getByRole('button', { name: 'All reports' }).click();
	const firstAlert = page.locator('section[aria-labelledby="attention-title"] li button').first();
	if (await firstAlert.count()) {
		await firstAlert.scrollIntoViewIfNeeded();
		await firstAlert.click();
		await page.waitForTimeout(900);
		await expect(page.getByRole('complementary', { name: /./ }).last()).toBeVisible();
		await page.screenshot({ path: `.playwright/screenshots/${info.project.name}-03-detail.png` });
	}

	// Ignore the favicon 404 the app shell already has; anything else is a failure.
	expect(errors.filter((e) => !/favicon/i.test(e))).toEqual([]);
});

test('numbers and graphs on top, map below; charts pick a day; wheel scrolls the page', async ({ page }, info) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.goto('/dashboard');
	await page.waitForTimeout(800);
	await page.screenshot({ path: `.playwright/screenshots/${info.project.name}-08-fullpage.png`, fullPage: true });

	// Layout order: headline numbers and graphs come before the map.
	const kpiTop = (await page.getByRole('heading', { name: /From the daily reports/ }).boundingBox())!.y;
	const chartsTop = (await page.getByRole('heading', { name: /Day by day/ }).boundingBox())!.y;
	const mapTop = (await page.getByRole('heading', { name: /^Map/ }).boundingBox())!.y;
	expect(kpiTop).toBeLessThan(chartsTop);
	expect(chartsTop).toBeLessThan(mapTop);

	// Picking a day on a chart selects that day: from the latest day (Nov 19), one step left is
	// Nov 18. Keyboard rather than pixel positions, so layout changes above can't move the target.
	const water = page.getByRole('slider', { name: /Water injected by day/ });
	await water.focus();
	await page.keyboard.press('ArrowLeft');
	await expect(water).toHaveAttribute('aria-valuetext', /^Nov 18:/);
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: 'From the daily reports · Nov 18' })).toBeVisible();

	if (info.project.name === 'desktop') {
		// A plain wheel over the map scrolls the page and leaves the map alone…
		const mapEl = page.getByRole('application');
		await mapEl.scrollIntoViewIfNeeded();
		const transform = () => page.locator('svg.canvas > g').first().getAttribute('transform');
		const before = await transform();
		const y0 = await page.evaluate(() => window.scrollY);
		const mb = (await mapEl.boundingBox())!;
		await page.mouse.move(mb.x + mb.width / 2, mb.y + 100);
		await page.mouse.wheel(0, -400);
		await page.waitForTimeout(400);
		expect(await transform()).toBe(before);
		expect(await page.evaluate(() => window.scrollY)).toBeLessThan(y0);
		// …and Ctrl + wheel zooms it.
		await mapEl.scrollIntoViewIfNeeded();
		const mb2 = (await mapEl.boundingBox())!;
		await page.mouse.move(mb2.x + mb2.width / 2, mb2.y + mb2.height / 2);
		await page.keyboard.down('Control');
		await page.mouse.wheel(0, -300);
		await page.keyboard.up('Control');
		await page.waitForTimeout(300);
		expect(await transform()).not.toBe(before);
	}
	expect(errors).toEqual([]);
});

test('layers panel turns routes, wells and other layers on and off', async ({ page }, info) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.addInitScript(() => localStorage.removeItem('leaco:ops-layers')); // start from the Operations set
	await page.goto('/dashboard');
	await page.waitForLoadState('networkidle');

	// The old Census street layer is gone; the background map shows roads now.
	await expect(page.locator('path.road')).toHaveCount(0);
	const routes = page.locator('path.route');
	const wells = page.locator('svg.canvas g.hit circle[r="5.2"]');
	await expect(routes).toHaveCount(4);
	await expect.poll(() => wells.count()).toBeGreaterThan(50);

	await page.getByRole('button', { name: /Layers/ }).click();
	const panel = page.getByRole('region', { name: 'Map layers' });
	await expect(panel).toBeVisible();
	await expect(panel.getByRole('checkbox', { name: /Public roads/ })).toHaveCount(0);

	// The panel never runs past the bottom of the map, and scrolls when it's taller.
	const frame = (await page.getByRole('application').boundingBox())!;
	const pb = (await panel.boundingBox())!;
	expect(pb.y + pb.height).toBeLessThanOrEqual(frame.y + frame.height + 1);
	const overflow = await panel.evaluate((el) => el.scrollHeight > el.clientHeight);
	if (overflow) {
		await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
		await page.mouse.wheel(0, 600);
		await expect.poll(() => panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
	}
	const stateLine = panel.getByRole('checkbox', { name: /State line/ });
	await stateLine.uncheck();
	await expect(stateLine).not.toBeChecked();
	await stateLine.check();
	await page.screenshot({ path: `.playwright/screenshots/${info.project.name}-04-layers.png` });

	await panel.getByRole('checkbox', { name: /Routes between LeaCo areas/ }).uncheck();
	await expect(routes).toHaveCount(0);
	await panel.getByRole('checkbox', { name: /Producing wells/ }).uncheck();
	await expect(wells).toHaveCount(0);
	await page.screenshot({ path: `.playwright/screenshots/${info.project.name}-05-routes-wells-off.png` });

	await panel.getByRole('button', { name: 'Operations' }).click();
	await expect(routes).toHaveCount(4);
	await page.getByRole('button', { name: /Layers/ }).click(); // close

	// Zoom to Winkler Ranch and open the route from Rhodes & Wills.
	await page.getByLabel('Go to').selectOption('winkler');
	await page.waitForTimeout(900);
	await page.screenshot({ path: `.playwright/screenshots/${info.project.name}-06-winkler.png` });
	await routes.first().dispatchEvent('click');
	await expect(page.getByRole('complementary').filter({ hasText: 'not confirmed with LeaCo' })).toBeVisible();
	await page.screenshot({ path: `.playwright/screenshots/${info.project.name}-07-route-detail.png` });

	expect(errors).toEqual([]);
});

test('detail drawer sends someone to an injector with Google and Apple Maps', async ({ page, context }, info) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.goto('/dashboard');
	// Wait for the page to finish loading its scripts before typing; an Enter
	// pressed earlier is a plain form submit that reloads the page.
	await page.waitForLoadState('networkidle');

	const search = page.getByLabel('Find a well or injector');
	await search.scrollIntoViewIfNeeded();
	await search.fill('MLMU 141');
	await search.press('Enter');

	const drawer = page.getByRole('complementary').filter({ hasText: 'Send someone here' });
	await expect(drawer).toBeVisible();
	const google = drawer.getByRole('link', { name: 'Google Maps' });
	const apple = drawer.getByRole('link', { name: 'Apple Maps' });
	await expect(google).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=32\.\d{5},-103\.\d{5}$/);
	await expect(apple).toHaveAttribute('href', /^https:\/\/maps\.apple\.com\/\?daddr=32\.\d{5},-103\.\d{5}&q=Myers%20Langlie%20Mattix/);
	await expect(google).toHaveAttribute('target', '_blank');

	await drawer.getByRole('button', { name: 'Copy location' }).click();
	await expect(drawer.getByRole('status')).toContainText('Copied');
	const clip = await page.evaluate(() => navigator.clipboard.readText());
	expect(clip).toContain('Myers Langlie Mattix Unit 141');
	expect(clip).toContain('approximate');

	await drawer.scrollIntoViewIfNeeded();
	await page.screenshot({ path: `.playwright/screenshots/${info.project.name}-09-directions.png` });
	expect(errors).toEqual([]);
});

test('background map fills the view at any zoom and can be switched', async ({ page }, info) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	const tileStatus: number[] = [];
	page.on('response', (r) => {
		if (r.url().startsWith('https://basemap.nationalmap.gov/')) tileStatus.push(r.status());
	});
	// Clear saved choices once (not on the reload below, which checks they are remembered).
	await page.addInitScript(() => {
		if (sessionStorage.getItem('cleared')) return;
		sessionStorage.setItem('cleared', '1');
		localStorage.removeItem('leaco:ops-basemap');
		localStorage.removeItem('leaco:ops-layers');
	});
	await page.goto('/dashboard');
	await page.waitForLoadState('networkidle');

	const map = page.getByRole('application');
	await map.scrollIntoViewIfNeeded();
	const tiles = page.locator('svg.canvas image');
	await expect.poll(() => tiles.count()).toBeGreaterThan(4);
	await expect.poll(() => tileStatus.filter((s) => s === 200).length, { timeout: 15_000 }).toBeGreaterThan(4);
	await expect(page.getByText('Background: USGS The National Map (Topo)')).toBeVisible();

	// Zoom well out: the background should still cover the whole map.
	await map.click({ position: { x: 20, y: 200 } });
	for (let i = 0; i < 4; i++) await page.keyboard.press('-');
	await page.waitForTimeout(1500);
	await page.screenshot({ path: `.playwright/screenshots/${info.project.name}-10-zoomed-out-topo.png` });

	await page.getByRole('button', { name: /Layers/ }).click();
	await page.locator('label', { hasText: 'Aerial photo' }).click();
	await expect(page.getByRole('radio', { name: 'Aerial photo' })).toBeChecked();
	await expect.poll(async () => (await tiles.first().getAttribute('href')) ?? '').toContain('USGSImageryOnly');
	await page.getByRole('button', { name: /Layers/ }).click();
	await page.getByRole('button', { name: 'Show all areas' }).click();
	await page.waitForTimeout(1500);
	await page.screenshot({ path: `.playwright/screenshots/${info.project.name}-11-aerial.png` });

	await page.getByRole('button', { name: /Layers/ }).click();
	await page.locator('label').filter({ has: page.getByRole('radio', { name: 'None' }) }).click();
	await expect(tiles).toHaveCount(0);

	// The choice is remembered on reload.
	await page.reload();
	await page.waitForLoadState('networkidle');
	await expect(page.locator('svg.canvas image')).toHaveCount(0);

	expect(tileStatus.filter((s) => s >= 400)).toEqual([]);
	expect(errors).toEqual([]);
});

test('live Amplified panel shows current well status, and a linked well shows its live readings', async ({ page }, info) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.goto('/dashboard');
	await page.waitForLoadState('networkidle');

	const panel = page.getByRole('region', { name: /Live from Amplified/ });
	await expect(panel).toBeVisible();
	await expect(panel).toContainText('Synced');
	await expect(panel).toContainText('Wells right now');
	await expect(panel).toContainText(/\d+ running/);
	await expect(panel).toContainText('Amplified lease ledger, UTC day');
	await expect(panel.getByRole('alert')).toHaveCount(0); // no sync error
	await panel.screenshot({ path: `.playwright/screenshots/${info.project.name}-13-live-panel.png` });

	// East Eumont 21 is linked: its drawer shows live readings.
	const search = page.getByLabel('Find a well or injector');
	await search.scrollIntoViewIfNeeded();
	await search.fill('East Eumont Unit 21');
	await search.press('Enter');
	const box = page.getByRole('region', { name: /Live from Amplified ·/ });
	await expect(box).toContainText(/Right now: (Running|Idle|Shutdown|No reading)/);
	await expect(box).toContainText('Amplified asset East_Eumont_Unit_21');

	// East Eumont 18 Injector is awaiting confirmation: it says so instead of guessing.
	await search.fill('East Eumont Unit 18 Injector');
	await search.press('Enter');
	await expect(page.getByRole('region', { name: /Live from Amplified ·/ })).toContainText('Not linked to Amplified yet');
	await page.screenshot({ path: `.playwright/screenshots/${info.project.name}-14-not-linked.png` });

	expect(errors).toEqual([]);
});
