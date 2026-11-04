import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('public Help works without workspace access and supports keyboard navigation', async ({
  page,
}, testInfo) => {
  let privateReads = 0;
  await page.route('**/api/v1/**', async (route) => {
    privateReads++;
    await route.fulfill({ status: 401, json: { error: { code: 'unauthenticated' } } });
  });
  await page.goto('/help');
  await expect(page.getByRole('heading', { name: 'Accord help', exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to guide' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await page.getByRole('link', { name: 'User guide', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Using Accord', exact: true })).toBeVisible();
  expect(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  if (testInfo.project.name === 'mobile') {
    await expect(page.locator('.mobile-contents')).not.toHaveAttribute('open', '');
    await page.locator('.mobile-contents summary').click();
    await expect(
      page.locator('.mobile-contents').getByRole('link', { name: 'First sign-in' }),
    ).toBeVisible();
    await page.locator('.mobile-contents summary').click();
  }
  await page.screenshot({
    path: `test-results/help-${testInfo.project.name}.png`,
    fullPage: false,
  });
  await page.getByRole('link', { name: 'For agents', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Accord agent operating guide', exact: true }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: `test-results/agent-help-${testInfo.project.name}.png`,
    fullPage: false,
  });
  expect(privateReads).toBe(0);
});

test('agent discovery and schemas are public downloadable data', async ({ request }) => {
  const discovery = await request.get('/llms.txt');
  expect(discovery.ok()).toBe(true);
  expect(await discovery.text()).toContain('/docs/agent-manifest.json');
  const full = await request.get('/llms-full.txt');
  expect(await full.text()).toContain('Retry protocol');
  const manifest = await (await request.get('/docs/agent-manifest.json')).json();
  const schema = await (await request.get('/docs/openapi.json')).json();
  expect(manifest.authentication.type).toBe('bearer');
  expect(schema.openapi).toBe('3.1.0');
  expect(manifest.commands.length).toBeGreaterThan(30);
  const example = await request.get('/docs/example-agent.ts');
  expect(example.ok()).toBe(true);
});
