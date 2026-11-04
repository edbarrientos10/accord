import { readFile, readdir, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { schemas, humanOnly, type CommandName } from '../src/domain/commands';
import { agentScopes, peopleScopes, workspaceCommandScopes } from '../src/domain/permissions';
import { renderMarkdown, guides } from '../scripts/docs';

const read = (path: string) => readFile(path, 'utf8');
describe('published documentation contract', () => {
  it('covers every actual REST route and describes human/worker/verifier command boundaries', async () => {
    const openapi = JSON.parse(await read('docs/openapi.json'));
    const manifest = JSON.parse(await read('docs/agent-manifest.json'));
    const files = await readdir('src/app/api/v1', { recursive: true });
    const routes = files
      .filter((f) => f.endsWith('route.ts'))
      .map((f) => '/api/v1/' + f.replace(/\/route\.ts$/, '').replace(/\[([^\]]+)\]/g, '{$1}'));
    for (const route of routes.filter((r) => !r.includes('{command}')))
      expect(openapi.paths, route).toHaveProperty(route);
    expect(manifest.commands.map((c: { name: string }) => c.name).sort()).toEqual(
      Object.keys(schemas).sort(),
    );
    for (const c of manifest.commands) {
      expect(
        openapi.paths[c.path].post.requestBody.content['application/json'].schema,
      ).toBeTruthy();
      expect(c.mcpTool).toBe('accord_' + c.name.replaceAll('.', '_'));
      if (humanOnly.has(c.name)) expect(c.roles).toEqual(['human']);
      else if (c.name === 'evidence.verify') expect(c.roles).toEqual(['human', 'integration']);
      else expect([...agentScopes, ...workspaceCommandScopes]).toContain(c.name);
      expect(c.requiresWorkspaceAccess).toBe(
        (workspaceCommandScopes as readonly string[]).includes(c.name),
      );
      expect(c.alsoRequiresPeopleRead).toBe(peopleScopes.includes(c.name));
    }
  });

  it('keeps fictional examples valid against runtime request validators', async () => {
    const examples = JSON.parse(await read('docs/examples.json')).examples;
    expect(examples.length).toBeGreaterThanOrEqual(10);
    for (const example of examples) {
      const name = example.command as CommandName;
      expect(schemas[name].safeParse(example.input).success, name).toBe(true);
      expect(example.input.reason).toBeTruthy();
    }
  });

  it('resolves all canonical guide links and section fragments', async () => {
    for (const name of guides) {
      const path = `docs/${name}.md`,
        source = await read(path);
      for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const href = match[1];
        if (/^https?:/.test(href)) continue;
        const [file, fragment] = href.split('#');
        const target = resolve(dirname(path), file || `${name}.md`);
        await expect(access(target), `${path}: ${href}`).resolves.toBeUndefined();
        if (fragment)
          expect(renderMarkdown(await read(target)).html, `${path}: ${href}`).toContain(
            `id="${fragment}"`,
          );
      }
    }
  });

  it('publishes navigable HTML with escaped source content and local links/assets', async () => {
    for (const name of guides) {
      const path = `public/help/${name}.html`,
        html = await read(path);
      for (const match of html.matchAll(/(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)) {
        const href = match[1].split('#')[0];
        if (/^https?:/.test(href) || href === '/') continue;
        await expect(
          access(href.startsWith('/') ? `public${href}` : resolve(dirname(path), href)),
          `${path}: ${href}`,
        ).resolves.toBeUndefined();
      }
      expect(html).not.toContain('<script');
    }
    const malicious = renderMarkdown(
      '# Example\n\n<script>alert(1)</script>\n\n```html\n<img src=x onerror=alert(1)>\n```',
    ).html;
    expect(malicious).not.toContain('<script');
    expect(malicious).not.toContain('<img');
    expect(() => renderMarkdown('[bad](javascript:alert)')).toThrow('Unsupported published link');
  });
});
