import { createHash } from 'node:crypto';
import { fixtureLogPage, fixtureLogSummaries, logQuerySchema } from '../../src/domain/logs';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fixture, MemoryRepository } from '../helpers';
import { execute } from '../../src/server/repository';
import { applyCommand } from '../../src/domain/service';
import type { Action, Workstream } from '../../src/domain/types';
async function installFixture(page: Page) {
  const f = fixture();
  const task = f.create();
  // Today defaults to personal handoffs; this fixture is explicitly waiting on the human.
  task.nextAction!.ownerId = f.human.id;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === '/api/v1/state') {
      await route.fulfill({
        json: {
          state: {
            ...f.state,
            audit: url.searchParams.get('history') === 'none' ? [] : f.state.audit,
          },
          actor: f.human,
        },
      });
      return;
    }
    if (url.pathname === '/api/v1/logs') {
      await route.fulfill({
        json: fixtureLogPage(
          f.state,
          logQuerySchema.parse(Object.fromEntries(url.searchParams)),
          f.attempts,
        ),
      });
      return;
    }
    if (url.pathname.startsWith('/api/v1/logs/')) {
      const id = url.pathname.split('/').at(-1),
        summary = fixtureLogSummaries(f.state, f.attempts).find((r) => r.id === id);
      await route.fulfill({
        status: summary ? 200 : 404,
        json: summary
          ? {
              summary,
              event: f.state.audit.find((e) => e.id === id) ?? null,
              attempt: f.attempts.find((a) => a.event.id === id)?.event ?? null,
            }
          : { error: { message: 'Event not found.' } },
      });
      return;
    }
    if (url.pathname.startsWith('/api/v1/commands/')) {
      try {
        const result = applyCommand(
          f.state,
          f.human,
          url.pathname.split('/').at(-1)!,
          request.postDataJSON(),
        );
        f.state = result.state;
        await route.fulfill({ json: { result: result.result } });
      } catch (e) {
        await route.fulfill({ status: 400, json: { error: { message: (e as Error).message } } });
      }
      return;
    }
    await route.fulfill({ json: { credentials: [] } });
  });
  return f;
}

test('external task changes refresh automatically and preserve an open draft', async ({ page }) => {
  const f = await installFixture(page);
  const task = f.state.workstreams[0];
  await page.goto(`/tasks/${task.id}`);
  await page.getByRole('button', { name: 'Edit task title', exact: true }).click();
  await page.getByLabel('Task title', { exact: true }).fill('Unsaved local title');
  f.command('workstream.update', {
    entityId: task.id,
    expectedVersion: task.version,
    title: 'Changed by another client',
    priority: 'urgent',
    reason: 'External task update',
  });
  const refreshed = page.waitForResponse('**/api/v1/state?history=none');
  await (await refreshed).finished();
  await expect(page.getByLabel('Task priority', { exact: true })).toHaveValue('urgent');
  await expect(page.getByLabel('Task title', { exact: true })).toHaveValue('Unsaved local title');
  await page.locator('.inline-editor').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit task title', exact: true })).toContainText(
    'Changed by another client',
  );
});

test('a delayed background snapshot cannot overwrite a task saved in this tab', async ({
  page,
}) => {
  const f = await installFixture(page);
  const task = f.state.workstreams[0];
  await page.goto(`/tasks/${task.id}`);
  const priority = page.getByLabel('Task priority', { exact: true });
  await expect(priority).toBeVisible();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  let holdNext = true;
  await page.route('**/api/v1/state?history=none', async (route) => {
    if (!holdNext) return route.fallback();
    holdNext = false;
    const snapshot = structuredClone(f.state);
    started();
    await held;
    await route.fulfill({ json: { state: snapshot, actor: f.human } });
  });
  await requested;
  await priority.selectOption('urgent');
  await expect(page.getByRole('status')).toContainText('Saved.');
  await expect(priority).toHaveValue('urgent');
  const response = page.waitForResponse('**/api/v1/state?history=none');
  release();
  await (await response).finished();
  await expect(priority).toHaveValue('urgent');
});

test('background refresh retries failures and refreshes on reconnect and focus', async ({
  page,
}) => {
  const f = await installFixture(page);
  const task = f.state.workstreams[0];
  await page.goto(`/tasks/${task.id}`);
  const title = page.getByRole('button', { name: 'Edit task title', exact: true });
  await expect(title).toContainText(task.title);
  let fail = true;
  await page.route('**/api/v1/state?history=none', async (route) => {
    if (fail) await route.fulfill({ status: 503, json: { error: { message: 'Offline' } } });
    else await route.fallback();
  });
  f.command('workstream.update', {
    entityId: task.id,
    expectedVersion: task.version,
    title: 'Updated while offline',
    reason: 'External task update',
  });
  const failed = page.waitForResponse(
    (r) => r.url().includes('/api/v1/state') && r.status() === 503,
  );
  await failed;
  await expect(title).toContainText(task.title);
  fail = false;
  const retried = page.waitForResponse('**/api/v1/state?history=none');
  await (await retried).finished();
  await expect(title).toContainText('Updated while offline');
  for (const event of ['online', 'focus']) {
    const current = f.current(task.id);
    f.command('workstream.update', {
      entityId: task.id,
      expectedVersion: current.version,
      title: `Updated on ${event}`,
      reason: 'External task update',
    });
    const resumed = page.waitForResponse('**/api/v1/state?history=none');
    await page.evaluate((event) => window.dispatchEvent(new Event(event)), event);
    await (await resumed).finished();
    await expect(title).toContainText(`Updated on ${event}`);
  }
});
async function newTask(page: Page) {
  await page.getByRole('button', { name: 'New task', exact: true }).last().click();
  return page.getByRole('dialog', { name: 'New task', exact: true });
}
async function proposal(f: ReturnType<typeof fixture>) {
  const w = f.state.workstreams[0];
  let r = applyCommand(f.state, f.human, 'action.propose', {
    workstreamId: w.id,
    expectedVersion: w.version,
    operation: 'send_email',
    effect: 'Send fictional draft',
    target: 'fictional-recipient',
    content: 'Exact fictional message version one',
    scope: 'Send this content once',
    expiresAt: '2099-01-01T00:00:00.000Z',
    reason: 'Prepare bounded proposal',
  });
  f.state = r.state;
  const a = f.state.actions[0];
  r = applyCommand(f.state, f.human, 'action.request_approval', {
    entityId: a.id,
    expectedVersion: a.version,
    reason: 'Request review',
  });
  f.state = r.state;
  return f.state.actions[0];
}
async function queueSelect(page: Page, title: string) {
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  const back = page.getByRole('button', { name: 'Back to queue' });
  if (await back.isVisible()) await back.click();
  const row = page.locator('.queue-row').filter({
    has: page.getByRole('heading', { name: title, exact: true, level: 3, includeHidden: true }),
  });
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

test('menu navigation preserves the workspace shell and loaded data', async ({ page }, info) => {
  await installFixture(page);
  let stateRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/state') stateRequests++;
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  const initialRequests = stateRequests;
  const shell = await page.locator('.app-shell').elementHandle();
  for (const [menu, heading] of [
    ['Tasks', 'Tasks'],
    ['Projects', 'Projects'],
    ['People', 'People'],
    ['Routines', 'Routines'],
    ['Agents', 'Agents'],
    ['Logs', 'Logs'],
    ['Settings', 'Workspace settings'],
    ['Today', 'Today'],
  ]) {
    if (info.project.name === 'mobile')
      await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await page
      .getByRole('link', { name: new RegExp('^' + menu + '(?: \\d+)?$') })
      .filter({ visible: true })
      .click();
    await expect(page.getByRole('heading', { name: heading, exact: true, level: 1 })).toBeVisible();
    expect(await shell!.evaluate((element) => element.isConnected)).toBe(true);
    expect(stateRequests).toBe(initialRequests);
  }
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'Workspace settings', exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  expect(await shell!.evaluate((element) => element.isConnected)).toBe(true);
  expect(stateRequests).toBe(initialRequests);
  await page.getByRole('button', { name: 'Refresh workspace' }).click();
  await expect.poll(() => stateRequests).toBe(initialRequests + 1);
  expect(await shell!.evaluate((element) => element.isConnected)).toBe(true);
});

test('dialog supports keyboard navigation, cancellation and focus restoration', async ({
  page,
}) => {
  await installFixture(page);
  await page.goto('/tasks');
  const dialog = await newTask(page);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Tab');
  expect(
    await page.evaluate(() =>
      document.querySelector('dialog[open]')?.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'New task', exact: true }).last()).toBeFocused();
});
test('password recovery retains the reset form with an authenticated fixture', async ({ page }) => {
  await installFixture(page);
  await page.goto('/reset-password');
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await expect(page.getByLabel('New password')).toBeVisible();
});
test('preview navigation, old links, and all redesigned surfaces render without overflow', async ({
  page,
}, info) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.getByText('Fictional, read-only preview', { exact: false })).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-today.png`, fullPage: true });
  await page.locator('.queue-row').first().click();
  await noOverflow(page);
  await page.screenshot({ path: `test-results/${info.project.name}-decision.png`, fullPage: true });
  if (info.project.name === 'mobile')
    await page.getByRole('button', { name: 'Back to queue' }).click();
  if (info.project.name === 'mobile')
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('link', { name: 'Tasks', exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
  await noOverflow(page);
  for (const route of [
    '/tasks',
    '/projects',
    '/routines',
    '/agents',
    '/settings',
    '/tasks?view=board',
  ]) {
    await page.goto(route);
    await expect(page.locator('main h1')).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: `test-results/${info.project.name}-${route.replace(/[^a-z]/g, '')}.png`,
      fullPage: true,
    });
  }
  await page.goto('/workstreams');
  await expect(page).toHaveURL(/\/tasks$/);
  await page.goto('/inbox');
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/operations');
  await expect(page).toHaveURL(/\/routines$/);
});
test('quick task creation defaults to simple and completes without fabricated verification', async ({
  page,
}) => {
  const f = await installFixture(page);
  await page.goto('/tasks');
  const dialog = await newTask(page);
  await dialog.getByLabel('Task title', { exact: true }).fill('Organize the notes');
  await expect(dialog.getByLabel('Acceptance criteria')).not.toBeVisible();
  await dialog.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Organize the notes', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Task: Organize the notes' });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Mark done', exact: true }).click();
  await expect(panel.getByLabel('Task status', { exact: true })).toHaveValue('completed');
  const w = f.state.workstreams.find((w) => w.title === 'Organize the notes')!;
  expect(w.completionPolicy).toBe('simple');
  expect(w.verifiedAt).toBeNull();
  expect(w.criteria).toEqual([]);
});
for (const view of ['panel', 'full page'] as const) {
  test(`task links add, edit, remove and remain readable when closed in ${view}`, async ({
    page,
  }, info) => {
    const f = await installFixture(page),
      task = f.state.workstreams[0];
    f.command('workstream.update', {
      entityId: task.id,
      expectedVersion: task.version,
      completionPolicy: 'simple',
      reason: 'Prepare simple task',
    });
    if (view === 'panel') {
      await page.goto('/tasks');
      await page.getByRole('button', { name: 'Fictional contract', exact: true }).click();
    } else await page.goto(`/tasks/${task.id}`);
    const links = page.getByRole('region', { name: 'Links', exact: true });
    await expect(links.getByText('No links yet.', { exact: false })).toBeVisible();
    const add = async (title: string, url: string, note = '') => {
      await links.getByRole('button', { name: 'Add link', exact: true }).click();
      const form = page.getByRole('dialog', { name: 'Add task link', exact: true });
      await form.getByLabel('Title', { exact: true }).fill(title);
      await form.getByLabel('URL', { exact: true }).fill(url);
      await form.getByLabel('Note', { exact: true }).fill(note);
      await form.getByRole('button', { name: 'Add link', exact: true }).click();
      return form;
    };
    const form = await add('Delivery notes', 'javascript:alert(1)', 'For review\nSecond line');
    await expect(form.getByRole('alert')).toContainText('HTTP or HTTPS');
    await form.getByRole('button', { name: 'Add link', exact: true }).click();
    await expect(form.getByRole('alert')).toContainText('HTTP or HTTPS');
    const url = 'https://example.com/' + 'resource'.repeat(80);
    await form.getByLabel('URL', { exact: true }).fill(url);
    await form.getByRole('button', { name: 'Add link', exact: true }).click();
    await expect(form).not.toBeVisible();
    await expect(links.getByRole('link', { name: 'Delivery notes', exact: true })).toHaveAttribute(
      'href',
      url,
    );
    await expect(links.getByText('For review\nSecond line')).toBeVisible();
    const id = f.state.workstreams[0].links[0].id;
    await add('Reference', 'https://example.com/reference');
    await expect(links.getByRole('article')).toHaveCount(2);
    const card = links.getByRole('article', { name: 'Delivery notes', exact: true });
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Edit task link', exact: true });
    await expect(editor.getByLabel('Note', { exact: true })).toHaveValue('For review\nSecond line');
    await editor.getByLabel('Title', { exact: true }).fill('Final delivery notes');
    await editor.getByLabel('Note', { exact: true }).fill('');
    await editor.getByRole('button', { name: 'Save link', exact: true }).click();
    await expect(editor).not.toBeVisible();
    expect(f.state.workstreams[0].links[0]).toEqual({ id, title: 'Final delivery notes', url });
    await links
      .getByRole('article', { name: 'Reference', exact: true })
      .getByRole('button', { name: 'Remove', exact: true })
      .click();
    const removal = page.getByRole('dialog', { name: 'Remove task link', exact: true });
    await removal.getByRole('button', { name: 'Remove link', exact: true }).click();
    await expect(removal).not.toBeVisible();
    await expect(links.getByRole('article')).toHaveCount(1);
    await noOverflow(page);
    expect(
      await links.getByRole('article').evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).include('.task-links').analyze()).violations).toEqual(
      [],
    );
    await links.getByRole('heading', { name: 'Links', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/${info.project.name}-task-links-${view.replace(' ', '-')}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Mark done', exact: true }).click();
    await expect(links.getByRole('button')).toHaveCount(0);
    await expect(
      links.getByRole('link', { name: 'Final delivery notes', exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(links.getByRole('button')).toHaveCount(0);
    await expect(
      links.getByRole('link', { name: 'Final delivery notes', exact: true }),
    ).toHaveAttribute('href', url);
    expect(f.state.evidence).toEqual([]);
  });
}

test('task link save failures retain input and retry keys; concurrent changes require reconciliation', async ({
  page,
}) => {
  const f = await installFixture(page),
    task = f.state.workstreams[0];
  await page.goto(`/tasks/${task.id}`);
  await page
    .getByRole('region', { name: 'Links', exact: true })
    .getByRole('button', { name: 'Add link', exact: true })
    .click();
  const form = page.getByRole('dialog', { name: 'Add task link', exact: true });
  await form.getByLabel('Title', { exact: true }).fill('Delivery notes');
  await form.getByLabel('URL', { exact: true }).fill('https://example.com/notes');
  const requests: { key: string | null; input: unknown }[] = [];
  await page.route('**/api/v1/commands/workstream.update', async (route) => {
    requests.push({
      key: route.request().headers()['idempotency-key'],
      input: route.request().postDataJSON(),
    });
    if (requests.length === 1)
      await route.fulfill({
        status: 503,
        json: { error: { message: 'Storage unavailable. Retry.' } },
      });
    else await route.fallback();
  });
  await form.getByRole('button', { name: 'Add link', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('Storage unavailable');
  await expect(form.getByLabel('Title', { exact: true })).toHaveValue('Delivery notes');
  await form.getByRole('button', { name: 'Add link', exact: true }).click();
  await expect(form).not.toBeVisible();
  expect(requests[1]).toEqual(requests[0]);
  const links = page.getByRole('region', { name: 'Links', exact: true });
  await links.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit task link', exact: true });
  await editor.getByLabel('Title', { exact: true }).fill('Revised notes');
  f.command('workstream.update', {
    entityId: task.id,
    expectedVersion: f.state.workstreams[0].version,
    links: [
      ...f.state.workstreams[0].links,
      {
        id: crypto.randomUUID(),
        title: 'Concurrent resource',
        url: 'https://example.com/concurrent',
      },
    ],
    reason: 'Concurrent addition',
  });
  await editor.getByRole('button', { name: 'Save link', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('Reload this record');
  await expect(editor.getByLabel('Title', { exact: true })).toHaveValue('Revised notes');
  expect(f.state.workstreams[0].links).toHaveLength(2);
  expect(f.state.workstreams[0].links[0].title).toBe('Delivery notes');
});

test('project grouping, assignment, filtering and URL-addressable task panel work together', async ({
  page,
}, info) => {
  const f = await installFixture(page);
  await page.goto('/projects');
  await page.getByRole('button', { name: 'New project', exact: true }).first().click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Project name').fill('Field research');
  await dialog.getByLabel('Description', { exact: true }).fill('Synthesize field notes');
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await page
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name: 'Field research' }) })
    .click();
  await expect(page.getByRole('heading', { name: 'Field research', level: 1 })).toBeVisible();
  await page.screenshot({
    path: `test-results/${info.project.name}-project-detail.png`,
    fullPage: true,
  });
  dialog = await newTask(page);
  await page.screenshot({
    path: `test-results/${info.project.name}-create-task.png`,
    fullPage: true,
  });
  await dialog.getByLabel('Task title').fill('Review field notes');
  await dialog.getByLabel('Task owner').selectOption(f.agent.id);
  await dialog.getByLabel('Priority', { exact: true }).selectOption('high');
  await dialog.getByLabel('Due date', { exact: true }).fill('2027-02-03');
  await dialog.getByRole('button', { name: 'Create task', exact: true }).click();
  await page.getByRole('button', { name: 'Review field notes', exact: true }).click();
  await expect(page).toHaveURL(/task=/);
  const panel = page.getByRole('region', { name: 'Task: Review field notes' });
  await expect(panel.getByLabel('Task owner')).toHaveValue(f.agent.id);
  await expect(panel.getByLabel('Task project')).toHaveValue(f.state.projects[0].id);
  await panel.getByLabel('Task priority').selectOption('urgent');
  await expect
    .poll(() => f.state.workstreams.find((w) => w.title === 'Review field notes')?.priority)
    .toBe('urgent');
  await page.goto('/tasks?owner=' + f.agent.id + '&priority=urgent');
  await expect(page.getByRole('button', { name: 'Review field notes', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Fictional contract', exact: true }),
  ).not.toBeVisible();
});
test('board menu uses lifecycle commands and blockers must be explicitly resolved', async ({
  page,
}) => {
  const f = await installFixture(page),
    w = f.state.workstreams[0];
  await page.goto('/tasks?view=board&status=all');
  await page.getByLabel('Move Fictional contract').selectOption('in_progress');
  await expect.poll(() => f.state.workstreams[0].planningStage).toBe('in_progress');
  await page.getByLabel('Move Fictional contract').selectOption('blocked');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Why progress stopped').fill('Missing package');
  await dialog.getByLabel('What was tried').fill('Checked the source');
  await dialog.getByLabel('Specific condition needed to continue').fill('Package available');
  await dialog.getByRole('button', { name: 'Record blocker', exact: true }).click();
  await expect(page.getByLabel('Move Fictional contract')).toHaveValue('blocked');
  await page.getByLabel('Move Fictional contract').selectOption('todo');
  await page.getByLabel('What resolved it?').fill('Package received');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Resolve blocker', exact: true })
    .click();
  await expect.poll(() => f.state.workstreams[0].blocker).toBeNull();
  expect(f.state.audit.some((a) => a.entityId === w.id && a.command === 'workstream.unblock')).toBe(
    true,
  );
});
test('human reviews exact content and approval remains separate from execution', async ({
  page,
}) => {
  const f = await installFixture(page);
  await proposal(f);
  await page.goto('/');
  await queueSelect(page, 'Send fictional draft');
  await expect(
    page.getByText('Exact fictional message version one', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Review & approve', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Exact fictional message version one');
  await dialog.getByRole('button', { name: 'Approve revision' }).click();
  await expect(dialog).not.toBeVisible();
  expect(f.state.grants).toHaveLength(1);
  expect(f.state.executions).toHaveLength(0);
  expect(f.state.decisions[0].response).toBe('approved');
  await expect(
    page.getByRole('heading', { name: 'Send fictional draft', level: 3 }),
  ).not.toBeVisible();
});
test('request changes and decline persist feedback and remove the proposal from Today', async ({
  page,
}) => {
  const f = await installFixture(page);
  const a = await proposal(f);
  await page.goto('/');
  await queueSelect(page, 'Send fictional draft');
  await page.getByRole('button', { name: 'Request changes', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Feedback for the agent').fill('Use a more specific recipient');
  await dialog.getByRole('button', { name: 'Request changes', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(f.state.decisions[0].response).toBe('changes_requested');
  expect(f.state.grants).toHaveLength(0);
  const w = f.state.workstreams[0];
  let r = applyCommand(f.state, f.human, 'action.propose', {
    workstreamId: w.id,
    expectedVersion: w.version,
    operation: a.operation,
    effect: 'Revised fictional draft',
    target: 'specific-recipient',
    content: 'Revised exact content',
    scope: a.scope,
    expiresAt: a.expiresAt,
    supersedesId: a.id,
    reason: 'Revise',
  });
  f.state = r.state;
  const revised = f.state.actions.at(-1)!;
  r = applyCommand(f.state, f.human, 'action.request_approval', {
    entityId: revised.id,
    expectedVersion: revised.version,
    reason: 'Review revision',
  });
  f.state = r.state;
  await page.reload();
  await queueSelect(page, 'Revised fictional draft');
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Feedback for the agent').fill('This message is no longer needed');
  await dialog.getByRole('button', { name: 'Decline proposal', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(f.state.decisions.at(-1)?.response).toBe('declined');
  expect(f.state.grants).toHaveLength(0);
});
test('snoozed queue is separate and a material task change brings the reminder back', async ({
  page,
}) => {
  const f = await installFixture(page),
    w = f.state.workstreams[0];
  let r = applyCommand(f.state, f.human, 'workstream.review', {
    entityId: w.id,
    expectedVersion: w.version,
    reason: 'Ready',
  });
  f.state = r.state;
  await page.goto('/');
  await queueSelect(page, w.title);
  await page.getByRole('button', { name: 'Snooze', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Snooze', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nothing needs you right now' })).toBeVisible();
  await page.getByRole('button', { name: /Snoozed 1/ }).click();
  await queueSelect(page, w.title);
  await expect(page.getByText('Snoozed until', { exact: false })).toBeVisible();
  r = applyCommand(f.state, f.human, 'workstream.update', {
    entityId: w.id,
    expectedVersion: f.state.workstreams[0].version,
    reportedProgress: 'Additional evidence prepared',
    reason: 'Material update',
  });
  f.state = r.state;
  await page.goto('/');
  await expect(page.getByRole('heading', { name: w.title, level: 3 })).toBeVisible();
});
test('verified creation requires criteria and closure records explicit human acceptance', async ({
  page,
}) => {
  const f = await installFixture(page);
  await page.goto('/tasks');
  const dialog = await newTask(page);
  await dialog.getByLabel('Task title').fill('Publish the guide');
  await dialog.getByLabel('Completion', { exact: true }).selectOption('verified');
  await dialog.getByLabel('Acceptance criteria').fill('Guide is reviewed\nInstallation succeeds');
  await dialog.getByRole('button', { name: 'Create task', exact: true }).click();
  await page.getByRole('button', { name: 'Publish the guide', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Task: Publish the guide' });
  await panel.getByRole('button', { name: 'Accept completion', exact: true }).click();
  const acceptance = page.getByRole('dialog', { name: 'Accept completion', exact: true });
  await acceptance
    .getByLabel('Your acceptance of the closure criteria')
    .fill('I reviewed the guide and completed an independent installation.');
  await acceptance.getByRole('button', { name: 'Accept completion', exact: true }).click();
  await expect(acceptance).not.toBeVisible();
  expect(f.state.workstreams.find((w) => w.title === 'Publish the guide')?.verifiedAt).toBeTruthy();
});
test('failed save retains form input and stale task errors remain visible', async ({ page }) => {
  const f = await installFixture(page);
  await page.goto('/tasks');
  const dialog = await newTask(page);
  await dialog.getByLabel('Task title').fill('Keep this draft');
  await page.route('**/api/v1/commands/workstream.create', (route) =>
    route.fulfill({ status: 503, json: { error: { message: 'Storage unavailable. Retry.' } } }),
  );
  await dialog.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Storage unavailable');
  await expect(dialog.getByLabel('Task title')).toHaveValue('Keep this draft');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Fictional contract', exact: true }).click();
  f.state.workstreams[0].version++;
  await page.getByLabel('Task priority').selectOption('high');
  await expect(page.getByRole('status')).toContainText('Reload this record');
});
test('task detail tabs, routine detail, reduced motion, and preview mutation boundary', async ({
  page,
}, info) => {
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Launch the community handbook', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Task: Launch the community handbook' });
  await expect(panel).toBeVisible();
  for (const name of ['Decisions', 'Evidence', 'Activity', 'Overview']) {
    await panel.getByRole('tab', { name: new RegExp('^' + name) }).click();
    await expect(panel.getByRole('tabpanel')).toBeVisible();
    await panel.screenshot({
      path: `test-results/${info.project.name}-task-${name.toLowerCase()}.png`,
    });
  }
  await panel.screenshot({ path: `test-results/${info.project.name}-task-detail.png` });
  await page.goto('/routines');
  await page
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name: 'Weekly briefing' }) })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Weekly briefing', exact: true, level: 1 }),
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: `test-results/${info.project.name}-routine-detail.png`,
    fullPage: true,
  });
  await page.goto('/tasks');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'New task', exact: true }).last().click();
  await expect(page.getByRole('status')).toContainText('read-only');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('record review keeps the task list beside the selected task', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  await page.goto('/tasks');
  const list = page.getByRole('navigation', { name: 'Tasks', exact: true });
  await expect(list).toBeVisible();
  if (!mobile)
    await expect(
      page.getByRole('region', { name: 'Task: Launch the community handbook' }),
    ).toBeVisible();
  await list.getByRole('button', { name: 'Agree on the studio lease', exact: true }).click();
  await expect(page).toHaveURL(/task=/);
  await expect(page.getByRole('region', { name: 'Task: Agree on the studio lease' })).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await noOverflow(page);
  if (mobile) {
    await expect(list).not.toBeVisible();
    await page.getByRole('button', { name: 'Back to tasks', exact: true }).click();
    await expect(list).toBeVisible();
  } else {
    await page.keyboard.press('ArrowDown');
    await expect(
      page.getByRole('region', { name: 'Task: Prepare the monthly field report' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Previous task', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'Task: Agree on the studio lease' }),
    ).toBeVisible();
    await page.screenshot({ path: `test-results/${info.project.name}-task-review.png` });
  }
  await page.goto('/tasks?view=board');
  await page.getByRole('button', { name: 'Restore the research archive', exact: true }).click();
  await expect(page).not.toHaveURL(/view=board/);
  await expect(
    page.getByRole('region', { name: 'Task: Restore the research archive' }),
  ).toBeVisible();
});

test('core surfaces meet automated WCAG AA accessibility checks', async ({ page }) => {
  for (const route of [
    '/',
    '/tasks',
    '/projects',
    '/routines',
    '/agents',
    '/settings',
    '/reset-password',
  ]) {
    await page.goto(route);
    await expect(page.locator('main')).toBeVisible();
    const report = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      report.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
      })),
      route,
    ).toEqual([]);
  }
});

test('loading, sign-in, and recovery remain readable when workspace access fails', async ({
  page,
}, info) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => url.pathname === '/api/v1/state',
    async (route) => {
      await gate;
      await route.fulfill({
        status: 401,
        json: { error: { message: 'Sign in to access your workspace.' } },
      });
    },
  );
  await page.goto('/');
  await expect(page.getByText('Opening your workspace', { exact: false })).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-loading.png`, fullPage: true });
  release();
  await expect(page.getByRole('heading', { name: 'Welcome to Accord' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: `test-results/${info.project.name}-signin.png`, fullPage: true });
  const report = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(report.violations).toEqual([]);
  await page.goto('/reset-password');
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: `test-results/${info.project.name}-recovery.png`, fullPage: true });
});

test('long task content and empty filters stay usable', async ({ page }, info) => {
  const f = await installFixture(page);
  const w = f.state.workstreams[0];
  w.title = 'Review a detailed research handoff with supporting evidence and a documented decision';
  w.outcome = ('A long source identifier: ' + 'x'.repeat(180) + '\n').repeat(8);
  await page.goto('/tasks');
  await page.getByRole('button', { name: w.title, exact: true }).click();
  const panel = page.getByRole('region', { name: 'Task: ' + w.title });
  await expect(panel).toBeVisible();
  await noOverflow(page);
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({
    path: `test-results/${info.project.name}-long-task.png`,
    fullPage: true,
  });
  const report = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    report.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.failureSummary) })),
  ).toEqual([]);
  await page.getByLabel('Search tasks').fill('no matching task');
  await expect(page.getByRole('heading', { name: 'A little room to make progress' })).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-empty.png`, fullPage: true });
});

test('People journey creates contacts, dates, interactions and commitments', async ({ page }) => {
  const f = await installFixture(page);
  await page.goto('/people');
  await page.getByRole('button', { name: 'New person', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'New person', exact: true });
  await dialog.getByLabel('Name', { exact: true }).fill('Jamie Rivera');
  await dialog.getByLabel('Relationship notes').fill('Ask about the garden.');
  await dialog.getByRole('button', { name: 'Create person' }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole('button')
    .filter({ has: page.getByText('Jamie Rivera', { exact: true }) })
    .click();
  const panel = page.getByRole('dialog', { name: 'Person: Jamie Rivera' });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Add date', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Add important date' });
  await dialog.getByLabel('Month (1–12)').fill('2');
  await dialog.getByLabel('Day', { exact: true }).fill('29');
  await dialog.getByRole('button', { name: 'Add date', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(f.state.importantDates[0].year).toBeNull();
  await panel.getByRole('button', { name: 'Log interaction', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Log interaction', exact: true });
  await dialog.getByLabel('What happened').fill('Caught up about the garden.');
  await dialog.getByRole('button', { name: 'Log interaction', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(f.state.interactions).toHaveLength(1);
  await panel.getByRole('button', { name: 'New commitment', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'New commitment' });
  await dialog.getByLabel('Requested outcome').fill('Send the revised outline');
  await dialog.getByLabel('Linked task').selectOption(f.state.workstreams[0].id);
  await dialog.getByLabel('Required for task completion').selectOption('true');
  await dialog.getByRole('button', { name: 'Record request' }).click();
  await expect(dialog).not.toBeVisible();
  await panel.getByRole('button', { name: 'Commitments', exact: true }).click();
  for (const status of ['committed', 'reported_done', 'fulfilled']) {
    await panel.getByRole('button', { name: 'Update state', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Update commitment state' });
    await dialog.getByLabel('New state').selectOption(status);
    await dialog.getByLabel('What establishes this change?').fill('Confirmed in the conversation');
    await dialog.getByRole('button', { name: 'Record state change' }).click();
    await expect(dialog).not.toBeVisible();
  }
  expect(f.state.commitments[0].status).toBe('fulfilled');
  expect(f.state.workstreams[0].status).toBe('open');
  await panel.getByRole('link', { name: 'Open person full page' }).click();
  await expect(page.getByRole('heading', { name: 'Jamie Rivera', exact: true })).toBeVisible();
  await noOverflow(page);
});

test('People import requires conflict review and preserves existing notes', async ({
  page,
}, info) => {
  const f = await installFixture(page);
  f.command('person.create', {
    name: 'Jamie',
    emails: [{ label: 'Other', value: 'jamie@example.com' }],
    notes: 'Existing note',
    reason: 'Fixture',
  });
  await page.goto('/people');
  await page.getByRole('button', { name: 'Import contacts' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import contacts' });
  await dialog.getByLabel('Contact file').setInputFiles({
    name: 'contacts.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'name,email,notes,birthday\nJamie,jamie@example.com,Imported note,02-29\nSam,sam@example.com,,',
    ),
  });
  await expect(dialog.getByText('Possible duplicate.', { exact: false })).toBeVisible();
  const bounds = await dialog.boundingBox();
  for (const control of await dialog.locator('.dialog-actions > *').all()) {
    const box = await control.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(bounds!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
  }
  await page.screenshot({
    path: `test-results/people-import-${info.project.name}.png`,
    fullPage: true,
  });
  await dialog.getByLabel('Import action for row 2').selectOption('update');
  await dialog.getByRole('button', { name: 'Import reviewed contacts' }).click();
  await expect(dialog.getByText('Choose which notes to keep.')).toBeVisible();
  await dialog.getByLabel('notes conflict for row 2').selectOption('keep');
  await dialog.getByRole('button', { name: 'Import reviewed contacts' }).click();
  await expect(dialog.getByText('2 imported · 2 rows')).toBeVisible();
  expect(f.state.people.find((p) => p.name === 'Jamie')?.notes).toBe('Existing note');
  expect(f.state.people.filter((p) => p.name === 'Sam')).toHaveLength(1);
  expect(f.state.importantDates).toHaveLength(1);
  await noOverflow(page);
});

test('People panels preserve focus and filters, and all views are accessible', async ({
  page,
}, info) => {
  await installFixture(page);
  await page.goto('/people');
  await expect(page.getByText('No people here yet')).toBeVisible();
  await page.getByRole('button', { name: 'New person', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Jamie Rivera');
  await page.getByRole('dialog').getByRole('button', { name: 'Create person' }).click();
  await expect(page.getByRole('dialog', { name: 'New person', exact: true })).not.toBeVisible();
  await page.getByLabel('Search people').fill('Jamie');
  await expect(page).toHaveURL(/q=Jamie/);
  const row = page
    .getByRole('button')
    .filter({ has: page.getByText('Jamie Rivera', { exact: true }) });
  await row.click();
  await expect(page.getByRole('dialog', { name: 'Person: Jamie Rivera' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Person: Jamie Rivera' })).not.toBeVisible();
  await expect(row).toBeFocused();
  await expect(page).toHaveURL(/q=Jamie/);
  for (const view of ['Directory', 'Commitments', 'Upcoming']) {
    await page
      .getByRole('navigation', { name: 'People views' })
      .getByRole('button', { name: view, exact: true })
      .click();
    await noOverflow(page);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
    await page.screenshot({
      path: `test-results/people-${view.toLowerCase()}-${info.project.name}.png`,
      fullPage: true,
    });
  }
});

test('fictional People preview covers directory, profile, commitments, upcoming and Today', async ({
  page,
}, info) => {
  await page.goto('/people');
  await expect(page.getByRole('heading', { name: 'People', exact: true })).toBeVisible();
  await page.screenshot({
    path: `test-results/people-demo-directory-${info.project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole('button')
    .filter({ has: page.getByText('Jamie Rivera', { exact: true }) })
    .click();
  await expect(page.getByRole('dialog', { name: 'Person: Jamie Rivera' })).toBeVisible();
  await page.screenshot({
    path: `test-results/people-demo-profile-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Close person' }).click();
  await expect(page.getByRole('dialog', { name: 'Person: Jamie Rivera' })).not.toBeVisible();
  for (const view of ['Commitments', 'Upcoming']) {
    await page
      .getByRole('navigation', { name: 'People views' })
      .getByRole('button', { name: view, exact: true })
      .click();
    await noOverflow(page);
    await page.screenshot({
      path: `test-results/people-demo-${view.toLowerCase()}-${info.project.name}.png`,
      fullPage: true,
    });
  }
  await page.goto('/?filter=people');
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await queueSelect(page, 'Jamie Rivera · Birthday');
  await expect(page.getByRole('button', { name: 'Acknowledge', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Supporting evidence', exact: true }),
  ).not.toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: `test-results/people-demo-today-${info.project.name}.png`,
    fullPage: true,
  });
});

test('contact import retries a lost response without duplicate records', async ({ page }) => {
  const f = await installFixture(page);
  f.command('person.create', {
    name: 'Jamie',
    emails: [{ label: 'Other', value: 'jamie@example.com' }],
    reason: 'Fixture',
  });
  const repo = new MemoryRepository(f.state);
  let lost = true;
  const payloads: string[] = [];
  await page.route('**/api/v1/commands/person.import', async (route) => {
    const request = route.request();
    payloads.push(request.postData()!);
    const result = await execute(
      repo,
      f.human,
      'person.import',
      request.postDataJSON(),
      request.headers()['idempotency-key'],
    );
    f.state = repo.state;
    if (lost) {
      lost = false;
      await route.abort('failed');
    } else await route.fulfill({ json: { result } });
  });
  await page.goto('/people');
  await page.getByRole('button', { name: 'Import contacts' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import contacts' });
  await dialog.getByLabel('Contact file').setInputFiles({
    name: 'one.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('name,email,birthday\nJamie,jamie@example.com,02-29'),
  });
  await dialog.getByLabel('Import action for row 2').selectOption('update');
  await dialog.getByRole('button', { name: 'Import reviewed contacts' }).click();
  await expect(dialog.getByText('Failed to fetch')).toBeVisible();
  await dialog.getByRole('button', { name: 'Import reviewed contacts' }).click();
  await expect(dialog.getByText('1 imported · 1 rows')).toBeVisible();
  expect(payloads).toHaveLength(2);
  expect(payloads[0]).toBe(payloads[1]);
  expect(f.state.people).toHaveLength(1);
  expect(f.state.importantDates).toHaveLength(1);
});

test('Logs inspect agent changes, preserve URL filters and refresh without replacing the shell', async ({
  page,
}, info) => {
  const f = await installFixture(page),
    w = f.state.workstreams[0];
  f.command(
    'workstream.update',
    {
      entityId: w.id,
      expectedVersion: w.version,
      reportedProgress: 'Draft ready for owner',
      reason: 'Reviewed the source notes',
    },
    f.agent,
  );
  await page.goto('/logs');
  await expect(page.getByRole('heading', { name: 'Logs', exact: true })).toBeVisible();
  await expect(page.locator('.log-row')).toHaveCount(1);
  await page.locator('.log-row').click();
  await expect(page).toHaveURL(/event=/);
  await expect(page.getByText('Reviewed the source notes', { exact: true })).toBeVisible();
  await expect(page.getByLabel('reportedProgress after', { exact: true })).toHaveText(
    'Draft ready for owner',
  );
  await expect(page.getByRole('link', { name: 'Open related record' })).toHaveAttribute(
    'href',
    `/tasks/${w.id}`,
  );
  await noOverflow(page);
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({
    path: `test-results/logs-detail-${info.project.name}.png`,
    fullPage: true,
  });
  if (info.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Back to logs' }).click();
    await expect(page.locator('.log-row')).toBeFocused();
  }
  await page.getByLabel('Search', { exact: true }).fill('no matching log');
  await expect(page.getByText('No matching activity', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Clear filters', exact: true }).click();
  await expect(page.locator('.log-row')).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Actor', exact: true })).toHaveValue('all');
  await page.getByRole('button', { name: 'Pause updates', exact: true }).click();
  f.command(
    'workstream.update',
    {
      entityId: w.id,
      expectedVersion: f.current(w.id).version,
      reportedProgress: 'Second update',
      reason: 'More findings',
    },
    f.agent,
  );
  const shell = await page.locator('.app-shell').elementHandle();
  await page.getByRole('button', { name: 'Refresh logs', exact: true }).click();
  await expect(page.locator('.log-row')).toHaveCount(3);
  expect(await shell!.evaluate((element) => element.isConnected)).toBe(true);
  await page.clock.install();
  f.command(
    'workstream.update',
    {
      entityId: w.id,
      expectedVersion: f.current(w.id).version,
      reportedProgress: 'Automatic refresh update',
      reason: 'New agent findings',
    },
    f.agent,
  );
  await page.getByRole('button', { name: 'Resume updates', exact: true }).click();
  await page.clock.fastForward(16000);
  await expect(page.locator('.log-row')).toHaveCount(4);
  await page.getByRole('button', { name: 'Pause updates', exact: true }).click();
  await page.screenshot({
    path: `test-results/logs-list-${info.project.name}.png`,
    fullPage: true,
  });
  await page.route(
    (url) => url.pathname === '/api/v1/logs',
    (route) =>
      route.fulfill({ status: 503, json: { error: { message: 'Temporarily unavailable' } } }),
  );
  await page.getByRole('button', { name: 'Refresh logs', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Showing the last loaded activity',
  );
  await expect(page.locator('.log-row')).toHaveCount(4);
});

test('Logs pages a large history and fetches failed-attempt details only on selection', async ({
  page,
}, info) => {
  const f = await installFixture(page),
    w = f.state.workstreams[0];
  const big = 'Historical content '.repeat(1000);
  for (let i = 0; i < 120; i++)
    f.state.audit.push({
      id: crypto.randomUUID(),
      actorId: f.agent.id,
      at: new Date(Date.UTC(2026, 9, 26, 12, 0, i)).toISOString(),
      command: 'workstream.update',
      entityId: w.id,
      reason: `Progress event ${i}`,
      changes: {
        before: { reportedProgress: big },
        after: { reportedProgress: big + ' updated', title: w.title },
      },
    });
  f.attempts.push({
    actorId: f.agent.id,
    event: {
      id: crypto.randomUUID(),
      at: '2026-10-26T14:00:00.000Z',
      command: 'workstream.update',
      entityId: w.id,
      outcome: 'rejected',
      code: 'conflict',
      message: 'The record changed. Reload before retrying.',
      transport: 'mcp',
      durationMs: 32,
      retryReference: 'safe-reference',
      validationFields: [],
    },
  });
  let stateReads = 0,
    detailReads = 0;
  const listSizes: number[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname === '/api/v1/state') stateReads++;
    if (u.pathname.startsWith('/api/v1/logs/')) detailReads++;
  });
  page.on('response', async (r) => {
    if (new URL(r.url()).pathname === '/api/v1/logs') {
      const data = await r.json();
      listSizes.push(data.items?.length ?? 0);
      expect(JSON.stringify(data)).not.toContain(big);
    }
  });
  await page.goto('/logs');
  await expect(page.locator('.log-row')).toHaveCount(50);
  expect(detailReads).toBe(0);
  await page.getByRole('button', { name: 'Pause updates', exact: true }).click();
  await page.locator('.log-row').first().click();
  await expect(page.getByText('conflict', { exact: true })).toBeVisible();
  expect(detailReads).toBe(1);
  await expect(page.getByText('MCP', { exact: true })).toBeVisible();
  await page.screenshot({
    path: `test-results/logs-attempt-${info.project.name}.png`,
    fullPage: true,
  });
  if (info.project.name === 'mobile')
    await page.getByRole('button', { name: 'Back to logs' }).click();
  await page.getByRole('button', { name: 'Older activity', exact: true }).click();
  await expect(page).toHaveURL(/cursor=/);
  await expect(page.locator('.log-row')).toHaveCount(50);
  await expect(page.locator('.log-row').first()).not.toContainText('Command attempt');
  await page.getByRole('button', { name: 'Newest activity', exact: true }).click();
  await expect(page.locator('.log-row').first()).toContainText('Command attempt');
  await page.getByRole('combobox', { name: 'Outcome', exact: true }).selectOption('rejected');
  await expect(page.locator('.log-row')).toHaveCount(1);
  expect(stateReads).toBe(1);
  expect(listSizes.every((n) => n <= 50)).toBe(true);
  await noOverflow(page);
});

test('workspace token issuance keeps assignments disabled and management opt-in', async ({
  page,
}) => {
  const f = await installFixture(page);
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/v1/credentials', async (route) => {
    if (route.request().method() === 'POST') {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 201,
        json: { token: 'accord_fictional_workspace_token', message: 'Save this token now.' },
      });
    } else await route.fulfill({ json: { credentials: [] } });
  });
  await page.goto('/agents');
  await page.getByRole('button', { name: 'Issue token', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Issue scoped credential' });
  await expect(dialog.getByLabel('Record access', { exact: true })).toHaveValue('assigned');
  await expect(dialog.getByRole('checkbox', { name: 'read', exact: true })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'project.create', exact: true })).toHaveCount(
    0,
  );
  const record = dialog.getByRole('checkbox', { name: f.state.workstreams[0].title, exact: true });
  await record.check();
  await dialog.getByLabel('Record access', { exact: true }).selectOption('workspace');
  await expect(record).toBeDisabled();
  const management = dialog.getByRole('checkbox', { name: 'project.create', exact: true });
  await expect(management).not.toBeChecked();
  await management.check();
  await dialog.getByRole('button', { name: 'Issue token', exact: true }).click();
  await expect(page.getByText('accord_fictional_workspace_token', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    accessMode: 'workspace',
    assignments: [],
    scopes: ['read', 'project.create'],
  });
  await page.getByRole('button', { name: 'I saved it · hide token' }).click();
  await page.getByRole('button', { name: 'Issue token', exact: true }).click();
  await expect(dialog.getByLabel('Record access', { exact: true })).toHaveValue('assigned');
  await expect(dialog.getByRole('checkbox', { name: 'read', exact: true })).toBeChecked();
});

test('Today dismisses a task with its linked reminders, persists closure and allows reopening', async ({
  page,
}) => {
  const f = await installFixture(page),
    w = f.state.workstreams[0];
  const person = f.command('person.create', { name: 'Jamie', reason: 'Test' }) as { id: string };
  f.command('commitment.create', {
    personId: person.id,
    title: 'Linked delivery',
    direction: 'waiting_on',
    coordinatorId: f.human.id,
    workstreamId: w.id,
    promisedDate: '2020-01-01',
    reason: 'Test',
  });
  await page.goto('/');
  await queueSelect(page, w.title);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).last().click();
  const dialog = page.getByRole('dialog', { name: 'Dismiss task', exact: true });
  await dialog.getByLabel('Reason for this change').fill('No longer pursuing this');
  await dialog.getByRole('button', { name: 'Dismiss task', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nothing needs you right now' })).toBeVisible();
  expect(f.current(w.id).status).toBe('dismissed');
  expect(f.current(w.id).closure?.reason).toBe('No longer pursuing this');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Nothing needs you right now' })).toBeVisible();
  f.command('workstream.reopen', {
    entityId: w.id,
    expectedVersion: f.current(w.id).version,
    reason: 'Needed again',
  });
  await page.reload();
  // Mobile may restore the selected detail; return to the queue before selecting.
  await queueSelect(page, w.title);
});

for (const required of [false, true]) {
  test(`Today dismisses a ${required ? 'required' : 'standalone'} commitment as closure`, async ({
    page,
  }) => {
    const f = await installFixture(page);
    const person = f.command('person.create', { name: 'Jamie', reason: 'Test' }) as { id: string };
    // A required commitment is shown with actions inside its linked task.
    f.command('commitment.create', {
      personId: person.id,
      title: 'No longer needed delivery',
      direction: 'waiting_on',
      coordinatorId: f.human.id,
      promisedDate: '2020-01-01',
      required,
      ...(required ? { workstreamId: f.state.workstreams[0].id } : {}),
      reason: 'Test',
    });
    await page.goto('/');
    await queueSelect(page, required ? f.state.workstreams[0].title : 'No longer needed delivery');
    const pane = page.getByRole('region', { name: 'Selected decision' });
    await pane.getByRole('button', { name: 'Dismiss', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Dismiss commitment', exact: true });
    await dialog.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(f.state.commitments[0].status).toBe(required ? 'waived' : 'cancelled');
    await page.reload();
    await expect(page.getByText('No longer needed delivery', { exact: true })).toHaveCount(0);
    expect(f.state.commitments[0].note).toBe('No longer needed');
  });
}

for (const category of ['contact', 'occasion'] as const) {
  test(`Today dismisses future ${category} reminders`, async ({ page }) => {
    const f = await installFixture(page);
    const person = f.command('person.create', {
      name: 'Jamie',
      cadenceMode: 'custom',
      cadenceDays: 1,
      reason: 'Test',
    }) as { id: string };
    if (category === 'occasion') {
      f.command('person.update', {
        entityId: person.id,
        expectedVersion: 1,
        cadenceMode: 'paused',
        reason: 'Test',
      });
      const date = new Intl.DateTimeFormat('en-CA', {
        timeZone: f.state.timezone,
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date());
      f.command('important_date.create', {
        personId: person.id,
        title: 'Anniversary',
        kind: 'anniversary',
        month: Number(date.find((p) => p.type === 'month')!.value),
        day: Number(date.find((p) => p.type === 'day')!.value),
        reason: 'Test',
      });
    }
    await page.goto('/?filter=people');
    await queueSelect(
      page,
      category === 'contact' ? 'Stay in touch with Jamie' : 'Jamie · Anniversary',
    );
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Dismiss reminder', exact: true });
    await dialog.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'You’re clear here' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'You’re clear here' })).toBeVisible();
    if (category === 'contact') expect(f.state.people[0].cadenceMode).toBe('paused');
    else expect(f.state.importantDates[0].active).toBe(false);
  });
}

test('Today edits everyday fields and progress in place, preserves selection and persists reloads', async ({
  page,
}, info) => {
  const f = await installFixture(page),
    w = f.state.workstreams[0];
  await page.goto('/');
  await queueSelect(page, w.title);
  const pane = page.getByRole('region', { name: 'Selected decision' });
  const edit = async (label: string, value: string) => {
    await pane.getByRole('button', { name: `Edit ${label.toLowerCase()}`, exact: true }).click();
    const field = pane.getByLabel(label, { exact: true });
    await field.fill(value);
    await field.locator('..').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(field).toHaveCount(0);
  };
  await edit('Task title', 'Updated directly in Today');
  await edit('Task description', 'A clearer desired outcome');
  await edit('Next step', 'Review the implementation');
  await pane.getByLabel('Task owner', { exact: true }).selectOption(f.agent.id);
  await expect.poll(() => f.current(w.id).ownerId).toBe(f.agent.id);
  expect(f.current(w.id).assignedAgentIds).toContain(f.agent.id);
  await pane.getByLabel('Task priority', { exact: true }).selectOption('urgent');
  await expect.poll(() => f.current(w.id).priority).toBe('urgent');
  await pane.getByLabel('Task due date', { exact: true }).fill('2020-01-01');
  await expect.poll(() => f.current(w.id).dueDate).toBe('2020-01-01');
  await pane.getByLabel('Task status', { exact: true }).selectOption('in_progress');
  await expect.poll(() => f.current(w.id).planningStage).toBe('in_progress');
  await pane.getByRole('tab', { name: 'Updates', exact: true }).click();
  await edit('Latest update', 'Reviewed with the owner');
  expect(f.current(w.id).reportedProgress).toBe('Reviewed with the owner');
  await pane.getByRole('button', { name: 'Upload file', exact: true }).click();
  const upload = page.getByRole('dialog', { name: 'Upload private evidence' });
  await expect(upload).toBeVisible();
  await page.route('**/api/v1/evidence/upload', async (route) => {
    const request = route.request();
    const body = await new Response(new Uint8Array(request.postDataBuffer()!), {
      headers: { 'Content-Type': request.headers()['content-type'] },
    }).formData();
    const metadata = JSON.parse(String(body.get('metadata')));
    expect(metadata.workstreamId).toBe(w.id);
    expect(await (body.get('file') as File).text()).toBe('Fictional supporting evidence');
    const result = applyCommand(f.state, f.human, 'evidence.attach', {
      ...metadata,
      storagePath: `${f.state.workspaceId}/${w.id}/test.txt`,
      sha256: createHash('sha256').update('Fictional supporting evidence').digest('hex'),
    });
    f.state = result.state;
    await route.fulfill({ json: { result: result.result } });
  });
  await upload.getByLabel('Evidence title').fill('Uploaded supporting note');
  await upload.getByLabel('What this establishes').fill('Fictional outcome evidence');
  await upload.getByLabel('Source and provenance').fill('Test document');
  await upload.getByLabel('Private evidence file').setInputFiles({
    name: 'test.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Fictional supporting evidence'),
  });
  await upload.getByLabel('Reason for this change').fill('Attach supporting file');
  await upload.getByRole('button', { name: 'Upload evidence', exact: true }).click();
  await expect(upload).not.toBeVisible();
  await expect(pane.getByText('Uploaded supporting note', { exact: true })).toBeVisible();
  await pane.getByRole('button', { name: 'Attach reference', exact: true }).click();
  const evidence = page.getByRole('dialog', { name: 'Attach evidence', exact: true });
  await evidence.getByLabel('Evidence title').fill('Supporting research');
  await evidence.getByLabel('What this establishes').fill('The outcome was reviewed');
  await evidence.getByLabel('Source and provenance').fill('Owner review');
  await evidence.getByLabel('Reference URL').fill('https://example.com/research');
  await evidence.getByLabel('Reason for this change').fill('Record evidence');
  await evidence.getByRole('button', { name: 'Save change', exact: true }).click();
  await expect(evidence).not.toBeVisible();
  await expect(pane.getByText('Supporting research', { exact: true })).toBeVisible();
  expect(f.state.evidence[0].workstreamId).toBe(w.id);
  await page.reload();
  await expect(pane.getByRole('button', { name: 'Edit task title' })).toContainText(
    'Updated directly in Today',
  );
  await expect(pane.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
  await expect(pane.getByLabel('Task priority', { exact: true })).toHaveValue('urgent');
  await noOverflow(page);
  if (info.project.name === 'desktop') {
    await page.setViewportSize({ width: 1076, height: 954 });
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
      true,
    );
    await expect(
      pane.getByRole('button', { name: 'Accept completion', exact: true }),
    ).toBeInViewport();
    await page.screenshot({ path: 'test-results/today-editing.png' });
  }
});

test('Today protects unsaved text when switching tabs, filters and tasks', async ({ page }) => {
  const f = await installFixture(page),
    w = f.state.workstreams[0];
  const other = f.create();
  other.title = 'Another queued task';
  other.nextAction!.ownerId = f.human.id;
  await page.goto('/');
  await queueSelect(page, w.title);
  const pane = page.getByRole('region', { name: 'Selected decision' });
  await pane.getByRole('button', { name: 'Edit task description' }).click();
  await pane.getByLabel('Task description', { exact: true }).fill('Unsaved description');
  await pane.getByRole('tab', { name: 'Updates', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(pane.getByLabel('Task description', { exact: true })).toHaveValue(
    'Unsaved description',
  );
  await page
    .locator('.queue-filters')
    .getByRole('button', { name: /Snoozed/ })
    .click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await pane.getByRole('tab', { name: 'Updates', exact: true }).click();
  await dialog.getByRole('button', { name: 'Discard changes' }).click();
  await expect(pane.getByRole('tab', { name: 'Updates' })).toHaveAttribute('aria-selected', 'true');
  expect(f.current(w.id).outcome).not.toBe('Unsaved description');
  await pane.getByRole('button', { name: 'Edit latest update' }).click();
  await pane.getByLabel('Latest update', { exact: true }).fill('Unsaved progress');
  const returningToQueue = await page.getByRole('button', { name: 'Back to queue' }).isVisible();
  if (returningToQueue) {
    await page.getByRole('button', { name: 'Back to queue' }).click();
  } else {
    await page.locator('.queue-row').filter({ hasText: other.title }).click();
  }
  await dialog.getByRole('button', { name: 'Discard changes' }).click();
  if (returningToQueue) await expect(page.locator('.decision-queue')).toBeVisible();
  await queueSelect(page, other.title);
  await expect(pane.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
});

test('Today retains failed drafts, rejects stale versions and suppresses duplicate saves', async ({
  page,
}) => {
  const f = await installFixture(page),
    w = f.state.workstreams[0];
  await page.goto('/');
  await queueSelect(page, w.title);
  const pane = page.getByRole('region', { name: 'Selected decision' });
  await pane.getByRole('button', { name: 'Edit task description' }).click();
  const field = pane.getByLabel('Task description', { exact: true });
  await field.fill('My unsaved outcome');
  // Change the actual record after the editor captured its expected version.
  f.command('workstream.update', {
    entityId: w.id,
    expectedVersion: w.version,
    outcome: 'Concurrent update',
    reason: 'Another editor',
  });
  await Promise.all([
    page.waitForResponse('**/api/v1/state?history=none'),
    page.getByRole('button', { name: 'Refresh workspace' }).click(),
  ]);
  await expect(field).toHaveValue('My unsaved outcome');
  let requests = 0;
  await page.route('**/api/v1/commands/workstream.update', async (route) => {
    requests++;
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fallback();
  });
  const save = field.locator('..').getByRole('button', { name: 'Save', exact: true });
  await save.dblclick();
  await expect(page.getByRole('status')).toContainText('Reload this record');
  await expect(field).toHaveValue('My unsaved outcome');
  expect(requests).toBe(1);
  expect(f.current(w.id).outcome).toBe('Concurrent update');
  await field.locator('..').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await expect(pane.getByRole('button', { name: 'Edit task description' })).toContainText(
    'Concurrent update',
  );
});

test('Today completes simple and verified tasks through existing closure rules', async ({
  page,
}) => {
  const f = await installFixture(page),
    verified = f.state.workstreams[0];
  const simple = f.command('workstream.create', {
    title: 'Quick Today task',
    outcome: 'Quick Today task',
    ownerId: f.human.id,
    assignedAgentIds: [],
    criteria: [],
    completionPolicy: 'simple',
    nextAction: { text: 'Do this now', ownerId: f.human.id },
    reason: 'Test',
  }) as Workstream;
  f.command('workstream.block', {
    entityId: verified.id,
    expectedVersion: verified.version,
    cause: 'Missing source document',
    attemptedResolution: 'Checked the archive',
    unblockCondition: 'Document received',
    resolverId: f.human.id,
    reason: 'Record blocker',
  });
  await page.goto('/');
  await queueSelect(page, verified.title);
  const pane = page.getByRole('region', { name: 'Selected decision' });
  await expect(pane.getByText('Missing source document', { exact: true })).toBeVisible();
  await pane.getByRole('button', { name: 'Resolve blocker', exact: true }).click();
  const resolution = page.getByRole('dialog', { name: 'Resolve blocker', exact: true });
  await resolution.getByLabel('What resolved it?').fill('Source document received');
  await resolution.getByRole('button', { name: 'Resolve blocker', exact: true }).click();
  await expect(resolution).not.toBeVisible();
  expect(f.current(verified.id).blocker).toBeNull();
  await page.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
  await queueSelect(page, simple.title);
  await pane.getByRole('button', { name: 'Mark done', exact: true }).click();
  await expect.poll(() => f.current(simple.id).status).toBe('completed');
  await page.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
  await queueSelect(page, verified.title);
  await pane.getByRole('button', { name: 'Accept completion', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Accept completion', exact: true });
  await dialog
    .getByLabel('Your acceptance of the closure criteria')
    .fill('The contract was accepted by its owner');
  await dialog.getByLabel('Reason for this change').fill('Verified completion');
  await dialog.getByRole('button', { name: 'Accept completion', exact: true }).click();
  await expect.poll(() => f.current(verified.id).status).toBe('completed');
  await expect(page.getByRole('heading', { name: 'Nothing needs you right now' })).toBeVisible();
});

test('Today keeps its default selection when priority reorders the queue', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'Mobile explicitly selects a queue item.');
  const f = await installFixture(page),
    first = f.state.workstreams[0];
  first.priority = 'urgent';
  const other = f.create();
  other.title = 'Higher priority after the edit';
  other.nextAction!.ownerId = f.human.id;
  other.priority = 'high';
  await page.goto('/');
  const pane = page.getByRole('region', { name: 'Selected decision' });
  await expect(pane.getByRole('button', { name: 'Edit task title' })).toContainText(first.title);
  await pane.getByLabel('Task priority', { exact: true }).selectOption('low');
  await expect(page.locator('.queue-row').first()).toContainText(other.title);
  await expect(pane.getByRole('button', { name: 'Edit task title' })).toContainText(first.title);
  await expect(page).toHaveURL(/\/$/);
});

test('Today tabs support keyboard navigation and preview saves stay read-only', async ({
  page,
}) => {
  await page.goto('/');
  await queueSelect(page, 'Launch the community handbook');
  const pane = page.getByRole('region', { name: 'Selected decision' });
  await pane.getByRole('tab', { name: 'Details', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(pane.getByRole('tab', { name: 'Updates', exact: true })).toBeFocused();
  await expect(pane.getByRole('tabpanel')).toHaveAccessibleName('Updates');
  await pane.getByRole('button', { name: 'Edit latest update' }).click();
  const field = pane.getByLabel('Latest update', { exact: true });
  await field.fill('A fictional preview edit');
  await field.locator('..').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('read-only');
  await expect(field).toHaveValue('A fictional preview edit');
  await field.locator('..').getByRole('button', { name: 'Cancel', exact: true }).click();
  await pane.getByRole('tab', { name: 'Updates', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect(pane.getByRole('tab', { name: 'Details', exact: true })).toBeFocused();
});

test('project favorites replace automatic shortcuts and remember their collapsed state', async ({
  page,
}, info) => {
  const f = await installFixture(page);
  const projects = Array.from(
    { length: 6 },
    (_, i) =>
      f.command('project.create', {
        name: `Favorite project ${i + 1}`,
        description: 'Fictional project',
        reason: 'Test favorites',
      }) as { id: string; name: string },
  );
  await page.goto('/projects');
  await expect(page.locator('.workspace-label')).toHaveCount(0);
  await expect(
    page.locator('.topbar').getByRole('button', { name: 'Log out', exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('.sidebar-bottom').getByRole('button', { name: 'Log out', exact: true }),
  ).toHaveCount(0);
  const mobile = info.project.name === 'mobile';
  const navigation = mobile
    ? page.getByRole('dialog', { name: 'Navigation', exact: true })
    : page.locator('aside.sidebar');
  const favorites = navigation.getByRole('region', { name: 'Favorite projects', exact: true });
  const openNavigation = async () => {
    if (mobile) await page.getByRole('button', { name: 'Toggle navigation' }).click();
  };
  const closeNavigation = async () => {
    if (mobile) await navigation.getByRole('button', { name: 'Close navigation' }).click();
  };
  await openNavigation();
  await expect(favorites.getByText('Star projects to keep them here.')).toBeVisible();
  await expect(favorites.getByRole('link', { name: projects[0].name, exact: true })).toHaveCount(0);
  await closeNavigation();
  for (const project of projects) {
    await page
      .getByRole('button', { name: `Add ${project.name} to favorites`, exact: true })
      .click();
  }
  await expect(page).toHaveURL(/\/projects$/);
  await openNavigation();
  for (const project of projects) {
    await expect(favorites.getByRole('link', { name: project.name, exact: true })).toBeVisible();
  }
  await favorites.getByRole('button', { name: /FAVORITES/ }).click();
  await expect(favorites.getByRole('button', { name: /FAVORITES/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(favorites.getByRole('link')).toHaveCount(0);
  await closeNavigation();
  await page.reload();
  await openNavigation();
  await expect(favorites.getByRole('button', { name: /FAVORITES/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await favorites.getByRole('button', { name: /FAVORITES/ }).click();
  await favorites.getByRole('link', { name: projects[5].name, exact: true }).click();
  await expect(
    page.getByRole('heading', { name: projects[5].name, exact: true, level: 1 }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: `Remove ${projects[5].name} from favorites`, exact: true })
    .click();
  await openNavigation();
  await expect(favorites.getByRole('link', { name: projects[5].name, exact: true })).toHaveCount(0);
  await expect(favorites.getByRole('link', { name: projects[0].name, exact: true })).toBeVisible();
  await closeNavigation();
  await noOverflow(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({
    path: `test-results/favorites-${info.project.name}.png`,
    fullPage: true,
  });
});

test('project favorites are isolated by actor and survive malformed stored preferences', async ({
  page,
}) => {
  const f = await installFixture(page);
  const project = f.command('project.create', {
    name: 'Personal favorite',
    description: '',
    reason: 'Test',
  }) as { id: string };
  const key = `accord:project-preferences:v1:${f.state.workspaceId}:${f.human.id}`;
  await page.addInitScript((key) => {
    if (!sessionStorage.getItem('corrupt-preferences-installed')) {
      localStorage.setItem(key, '{invalid');
      sessionStorage.setItem('corrupt-preferences-installed', 'true');
    }
  }, key);
  await page.goto('/projects');
  await page
    .getByRole('button', { name: 'Add Personal favorite to favorites', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Remove Personal favorite from favorites', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Remove Personal favorite from favorites', exact: true }),
  ).toBeVisible();
  const originalActor = f.human.id;
  f.human.id = f.thirdId;
  await page.getByRole('button', { name: 'Refresh workspace' }).click();
  await expect(
    page.getByRole('button', { name: 'Add Personal favorite to favorites', exact: true }),
  ).toBeVisible();
  f.human.id = originalActor;
  await page.getByRole('button', { name: 'Refresh workspace' }).click();
  await expect(
    page.getByRole('button', { name: 'Remove Personal favorite from favorites', exact: true }),
  ).toBeVisible();
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
  expect(saved.favorites).toEqual([project.id]);
});
