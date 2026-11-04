import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('system default tracks OS changes; overrides persist and can return to system', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/settings');
  const root = page.locator('html');
  const theme = page.getByRole('combobox', { name: 'Theme', exact: true });
  await expect(theme).toHaveValue('system');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(17, 21, 29)');
  await expect(theme).toHaveCSS('color-scheme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveAttribute('data-theme', 'light');

  await theme.selectOption('dark');
  await page.reload();
  await expect(theme).toHaveValue('dark');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'dark' });
  await theme.selectOption('light');
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(theme).toHaveValue('light');

  await theme.selectOption('system');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(theme).toHaveValue('system');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  expect(errors).toEqual([]);
});

test('appearance synchronizes between tabs and recovers from cleared storage', async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/settings');
  await expect(page.getByRole('combobox', { name: 'Theme', exact: true })).toBeVisible();
  const other = await context.newPage();
  await other.emulateMedia({ colorScheme: 'light' });
  await other.goto('/settings');
  await expect(other.getByRole('combobox', { name: 'Theme', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('dark');
  await expect(other.getByRole('combobox', { name: 'Theme', exact: true })).toHaveValue('dark');
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.evaluate(() => localStorage.clear());
  await expect(other.getByRole('combobox', { name: 'Theme', exact: true })).toHaveValue('system');
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('unavailable storage still allows theme changes', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error('Storage unavailable');
    };
    Storage.prototype.setItem = () => {
      throw new Error('Storage unavailable');
    };
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/settings');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('invalid saved themes fall back to system', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('accord.theme.v1', 'invalid'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/settings');
  await expect(page.getByRole('combobox', { name: 'Theme', exact: true })).toHaveValue('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('dark surfaces are accessible across the workspace', async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const path of [
    '/',
    '/tasks',
    '/projects',
    '/people',
    '/routines',
    '/agents',
    '/logs',
    '/settings',
  ]) {
    await page.goto(path);
    await expect(page.locator('.page-heading')).toBeVisible();
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(result.violations, path).toEqual([]);
  }
  await page.screenshot({
    path: `test-results/theme-dark-${info.project.name}.png`,
    fullPage: true,
  });
});
