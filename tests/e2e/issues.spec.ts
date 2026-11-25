import { expect, test } from '@playwright/test';

/**
 * Issues and issue rules (direction A phase 2), as the local test user sees them. That user
 * has no admin role, so the pages are read-only: the admin actions are covered by unit tests
 * of the server logic and checked by hand with an admin session.
 */
test('Issues page lists open issues by tab, read-only for non-admins', async ({ page }, info) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	page.on('console', (m) => {
		if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push(m.text());
	});

	await page.goto('/issues');
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('heading', { name: 'Issues', exact: true })).toBeVisible();
	await expect(page.getByRole('navigation', { name: 'Issue status' }).getByRole('link')).toHaveCount(4);
	await expect(page.getByText('only admins can change their status')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Contractor sent' })).toHaveCount(0);
	await page.screenshot({ path: `.playwright/screenshots/${info.project.name}-20-issues.png`, fullPage: true });

	await page.getByRole('link', { name: /^Archived/ }).click();
	await expect(page).toHaveURL(/tab=archived/);

	await page.getByRole('link', { name: 'When issues open' }).click();
	await expect(page.getByRole('heading', { name: 'When to open an issue' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Save rules' })).toHaveCount(0);
	await page.screenshot({ path: `.playwright/screenshots/${info.project.name}-21-rules.png`, fullPage: true });

	expect(errors).toEqual([]);
});

test('Overview links to the Issues page from Needs a contractor', async ({ page }) => {
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await page.locator('section[aria-labelledby="needs-title"]').getByRole('link', { name: 'Manage issues' }).click();
	await expect(page).toHaveURL(/\/issues$/);
});
