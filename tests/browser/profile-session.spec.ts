import { test, expect, type Page } from '@playwright/test';
import { fixture } from '../helpers';
import AxeBuilder from '@axe-core/playwright';
import { applyCommand } from '../../src/domain/service';

// Build with the same fictional Supabase settings (also configured in CI).
const authUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
test.skip(
  !authUrl,
  'Build with fictional NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to test sessions.',
);

async function install(page: Page) {
  const f = fixture();
  f.state.identities[0].name = 'Workspace owner';
  const user = {
    id: f.state.identities[0].authUserId!,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'owner@example.test',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  };
  const payload = Buffer.from(
    JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url');
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.fictional`,
    refresh_token: 'fictional-refresh',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user,
  };
  await page.addInitScript(
    ({ session, key }) => {
      if (!sessionStorage.getItem('session-fixture-installed')) {
        localStorage.setItem(key, JSON.stringify(session));
        sessionStorage.setItem('session-fixture-installed', 'true');
      }
    },
    { session, key: `sb-${new URL(authUrl!).hostname.split('.')[0]}-auth-token` },
  );
  const controls = { failLogout: false, failSave: false, logouts: 0 };
  await page.route(`${authUrl}/auth/v1/**`, async (route) => {
    if (route.request().url().includes('/logout')) {
      controls.logouts++;
      await route.fulfill(
        controls.failLogout
          ? { status: 400, json: { message: 'Temporary logout failure', code: 'test_failure' } }
          : { status: 204, body: '' },
      );
    } else await route.fulfill({ json: user });
  });
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (!req.headers().authorization) {
      await route.fulfill({
        status: 401,
        json: { error: { message: 'Sign in to your workspace.' } },
      });
      return;
    }
    if (path === '/api/v1/state') await route.fulfill({ json: { state: f.state, actor: f.human } });
    else if (path.endsWith('/profile.update')) {
      if (controls.failSave) {
        await route.fulfill({
          status: 409,
          json: { error: { message: 'Refresh the workspace before saving your profile.' } },
        });
        return;
      }
      const result = applyCommand(f.state, f.human, 'profile.update', req.postDataJSON());
      f.state = result.state;
      await route.fulfill({ json: { result: result.result } });
    } else await route.fulfill({ json: { credentials: [] } });
  });
  return { f, controls };
}

test('profile setup is optional, editable and persists after reload', async ({ page }, info) => {
  await install(page);
  await page.goto('/');
  const prompt = page.getByRole('region', { name: 'Profile setup' });
  await expect(prompt).toBeVisible();
  await page.getByRole('button', { name: 'Not now' }).click();
  await page.reload();
  await expect(prompt).toBeHidden();
  if (page.viewportSize()!.width < 768)
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('link', { name: /Edit your profile/ }).click();
  await expect(page).toHaveURL(/settings#your-profile/);
  await page.getByLabel('Display name').fill('  Jamie Taylor  ');
  await page.getByLabel('Role/title').fill('Designer');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status')).toContainText('Saved.');
  await expect(prompt).toBeHidden();
  await expect(page.locator('.workspace-indicator').first()).toContainText('Jamie Taylor');
  await expect(page.locator('.workspace-indicator .avatar').first()).toContainText('JT');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await page.screenshot({ path: info.outputPath('profile-settings.png'), fullPage: true });
  await page.reload();
  await expect(page.getByLabel('Display name')).toHaveValue('Jamie Taylor');
  await expect(page.getByLabel('Role/title')).toHaveValue('Designer');
  await expect(prompt).toBeHidden();
  await expect(page.locator('.workspace-indicator').first()).toContainText('Jamie Taylor');
  await page.getByLabel('Role/title').fill('');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status')).toContainText('Saved.');
  await page.reload();
  await expect(page.getByLabel('Role/title')).toHaveValue('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('failed profile save keeps entered values for retry', async ({ page }) => {
  const { controls } = await install(page);
  controls.failSave = true;
  await page.goto('/settings');
  await page.getByLabel('Display name').fill('Jamie');
  await page.getByLabel('Role/title').fill('Designer');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.locator('.profile-form').getByRole('alert')).toContainText('Refresh');
  await expect(page.getByLabel('Display name')).toHaveValue('Jamie');
  await expect(page.getByLabel('Role/title')).toHaveValue('Designer');
  controls.failSave = false;
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status')).toContainText('Saved.');
});

test('logout errors allow retry, and success stays signed out after reload', async ({ page }) => {
  const { controls } = await install(page);
  controls.failLogout = true;
  await page.goto('/settings');
  const logout = page.locator('.topbar').getByRole('button', { name: 'Log out', exact: true });
  await logout.click();
  await expect(page.getByRole('status')).toContainText('Could not log out');
  await expect(logout).toBeEnabled();
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  controls.failLogout = false;
  await logout.click();
  await expect(page.locator('.login-page')).toBeVisible();
  await page.reload();
  await expect(page.locator('.login-page')).toBeVisible();
  await expect(page.locator('.workspace-indicator')).toHaveCount(0);
  expect(controls.logouts).toBe(3);
});

test('logout ignores delayed workspace responses and disables repeat clicks', async ({ page }) => {
  const { f, controls } = await install(page);
  await page.goto('/settings');
  await expect(page.getByLabel('Display name')).toBeVisible();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested!: () => void;
  const started = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route('**/api/v1/state?history=none', async (route) => {
    requested();
    await held;
    await route.fulfill({ json: { state: f.state, actor: f.human } });
  });
  let releaseLogout!: () => void;
  const heldLogout = new Promise<void>((resolve) => {
    releaseLogout = resolve;
  });
  await page.route(`${authUrl}/auth/v1/logout*`, async (route) => {
    controls.logouts++;
    await heldLogout;
    await route.fulfill({ status: 204, body: '' });
  });
  await page.getByRole('button', { name: 'Refresh workspace' }).click();
  await started;
  await page.locator('.topbar').getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(
    page.locator('.topbar').getByRole('button', { name: 'Logging out…' }),
  ).toBeDisabled();
  releaseLogout();
  await expect(page.locator('.login-page')).toBeVisible();
  const completed = page.waitForResponse((response) => response.url().includes('/api/v1/state'));
  release();
  await completed;
  await expect(page.locator('.login-page')).toBeVisible();
  await expect(page.locator('.workspace-indicator')).toHaveCount(0);
  expect(controls.logouts).toBe(2);
});

test('fictional preview disables profile editing and hides account actions', async ({ page }) => {
  const f = fixture();
  f.state.identities[0].name = 'Workspace owner';
  await page.route('**/api/v1/state*', async (route) => {
    await route.fulfill({ json: { state: f.state, demo: true } });
  });
  await page.goto('/settings');
  await expect(page.getByLabel('Display name')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Log out' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Profile setup' })).toHaveCount(0);
});
