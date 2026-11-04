import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { format } from 'prettier';
import { schemas, humanOnly, type CommandName } from '../src/domain/commands';
import { workspaceCommandScopes, peopleScopes } from '../src/domain/permissions';
import { commandInfo } from '../src/domain/command-info';
import { renderOpenApi } from './schema';

// Explicitly publish only product docs. Never crawl workspace, environment, or backups.
export const guides = [
  'index',
  'user-guide',
  'agent-guide',
  'troubleshooting',
  'commands',
  'api',
  'people',
  'logs',
  'install',
  'recovery',
  'redesign',
  'architecture',
  'validation',
];
export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
const escape = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
function publicHref(href: string) {
  if (/^(https?:\/\/|#|\/)/.test(href)) return href;
  if (href === '../examples/agent.ts') return '/docs/example-agent.ts';
  if (/^[\w-]+\.md(?:#.*)?$/.test(href)) return href.replace('.md', '.html');
  if (/^[\w.-]+\.json$/.test(href)) return `/docs/${href}`;
  throw new Error(`Unsupported published link: ${href}`);
}
function inline(s: string): string {
  let out = '',
    cursor = 0;
  const tokens = /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
  for (const match of s.matchAll(tokens)) {
    out += escape(s.slice(cursor, match.index));
    if (match[1]) out += `<code>${escape(match[1])}</code>`;
    else if (match[2]) out += `<a href="${escape(publicHref(match[3]))}">${escape(match[2])}</a>`;
    else out += `<strong>${escape(match[4])}</strong>`;
    cursor = match.index! + match[0].length;
  }
  return out + escape(s.slice(cursor));
}
// Small, escaped renderer for the documented subset used in these trusted source files.
// Raw HTML, scripts, images, and arbitrary URI schemes are deliberately not interpreted.
export function renderMarkdown(source: string) {
  const lines = source.split('\n'),
    html: string[] = [],
    headings: { title: string; id: string }[] = [];
  const ids = new Map<string, number>();
  let i = 0,
    tableIndex = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      if (i === lines.length) throw new Error('Unclosed documentation code fence');
      i++;
      html.push(
        `<pre tabindex="0" aria-label="Code example"><code>${escape(code.join('\n'))}</code></pre>`,
      );
      continue;
    }
    const heading = /^(#{1,6}) (.+)$/.exec(line);
    if (heading) {
      const base = slug(heading[2]),
        count = ids.get(base) ?? 0;
      ids.set(base, count + 1);
      const id = count ? `${base}-${count}` : base,
        level = heading[1].length;
      if (level === 2) headings.push({ title: heading[2], id });
      html.push(`<h${level} id="${id}">${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }
    if (line.startsWith('|') && /^\|[\s:|-]+\|$/.test(lines[i + 1] ?? '')) {
      const cells = (row: string) =>
        row
          .trim()
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim());
      const headers = cells(line);
      i += 2;
      const rows: string[] = [];
      while (i < lines.length && lines[i].startsWith('|'))
        rows.push(
          `<tr>${cells(lines[i++])
            .map((v) => `<td>${inline(v)}</td>`)
            .join('')}</tr>`,
        );
      html.push(
        `<div class="table-scroll" tabindex="0" role="region" aria-label="${escape(headers[0])} reference table ${++tableIndex}"><table><thead><tr>${headers.map((h) => `<th scope="col">${inline(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`,
      );
      continue;
    }
    const list = /^(?:- |\d+\. )/.exec(line);
    if (list) {
      const ordered = /^\d/.test(line),
        tag = ordered ? 'ol' : 'ul';
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\d+\. / : /^- /).test(lines[i])) {
        let item = lines[i++].replace(/^(?:- |\d+\. )/, '');
        while (i < lines.length && /^ {2,}\S/.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(`<li>${inline(item)}</li>`);
      }
      html.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }
    const paragraph: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6} |```|\||- |\d+\. )/.test(lines[i]))
      paragraph.push(lines[i++]);
    html.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  return { html: html.join('\n'), headings };
}
function htmlPage(name: string, source: string) {
  const { html, headings } = renderMarkdown(source);
  const title = source.split('\n')[0].replace(/^# /, '');
  const toc = `<nav aria-label="Guide sections">${headings.map((h) => `<a href="#${escape(h.id)}">${escape(h.title)}</a>`).join('')}</nav>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Accord product documentation for people and agents"><title>${escape(title)} · Accord Help</title><link rel="icon" href="/brand/accord-favicon-v2.ico" sizes="16x16 32x32 48x48"><link rel="apple-touch-icon" href="/brand/accord-icon-180-v2.png"><link rel="stylesheet" href="/help/style.css"></head><body>
  <a class="skip" href="#main">Skip to guide</a><header><a class="brand" href="/help/index.html"><img src="/brand/accord-logo-dark-v2.webp" alt="Accord" width="160" height="50"> <small>HELP</small></a><nav aria-label="Help navigation"><a href="/help/user-guide.html">For people</a><a href="/help/agent-guide.html">For agents</a><a href="/help/troubleshooting.html">Troubleshooting</a><a href="/">Open workspace ↗</a></nav></header>
  <div class="layout"><aside aria-label="On this page"><div class="desktop-contents"><p class="eyebrow">ON THIS PAGE</p>${toc}</div><details class="mobile-contents"><summary>On this page</summary>${toc}</details><hr><a href="/docs/${name}.md">Read Markdown ↗</a><a href="/llms.txt">Agent discovery ↗</a><a href="/docs/openapi.json">OpenAPI schema ↗</a></aside><main id="main" tabindex="-1"><p class="eyebrow">WORKSPACE HANDBOOK / ${name === 'agent-guide' || name === 'commands' ? 'AGENTS' : 'ACCORD'}</p>${html}<footer>Documentation describes the app; it does not grant access to private records.<br><a href="/help/index.html">All guides</a> · <a href="/docs/${name}.md">Markdown source</a></footer></main></div></body></html>`;
}
export async function documentationOutputs() {
  const outputs = new Map<string, string | Buffer>();
  const commands = Object.keys(schemas).map((name) => {
    const command = name as CommandName;
    const roles = humanOnly.has(command)
      ? ['human']
      : command === 'evidence.verify'
        ? ['human', 'integration']
        : ['human', 'agent'];
    return {
      name,
      mcpTool: `accord_${name.replaceAll('.', '_')}`,
      method: 'POST',
      path: `/api/v1/commands/${name}`,
      roles,
      requiresWorkspaceAccess: (workspaceCommandScopes as readonly string[]).includes(command),
      agentScope: roles.includes('human') && roles.length === 1 ? null : name,
      alsoRequiresPeopleRead: peopleScopes.includes(command as (typeof peopleScopes)[number]),
      ...commandInfo[command],
    };
  });
  const commandDoc =
    '# Command reference\n\nGenerated from shared command metadata and validators. Do not edit this file directly.\n\nAll mutations require a reason and an idempotency key. Field-level authorization,\nassignment, lifecycle, and semantic refinements still apply. “Human, agent” means an\nexplicitly scoped agent, not any caller. People mutations also require `people.read`.\nRead [the agent guide](agent-guide.md) before invoking a command and use\n[OpenAPI](openapi.json) for exact required fields, types, defaults, and limits.\n\n' +
    commands
      .map(
        (c) =>
          `## ${c.name}\n\n${c.summary}\n\n- Callers: ${c.roles.join(', ')}.\n- Required mutation scope for non-human callers: ${c.agentScope ? '`' + c.agentScope + '`' : 'not available'}.${c.requiresWorkspaceAccess ? ' Requires workspace access for agents.' : ''}${c.alsoRequiresPeopleRead ? ' Also requires `people.read`.' : ''}\n- Version target: ${c.versionTarget}.\n- REST: \`${c.method} ${c.path}\`.\n- MCP: \`${c.mcpTool}\`.\n`,
      )
      .join('\n');
  outputs.set(
    'docs/commands.md',
    await format(commandDoc, { parser: 'markdown', printWidth: 100 }),
  );
  outputs.set('docs/openapi.json', await renderOpenApi());
  outputs.set(
    'docs/agent-manifest.json',
    await format(
      JSON.stringify({
        format: 'accord.agent.v1',
        appVersion: '0.1.0',
        documentationOnly: true,
        baseUrl:
          'Use the deployment origin supplied by the human; never infer authorization from this document.',
        authentication: {
          type: 'bearer',
          header: 'Authorization',
          agentTokenPrefix: 'accord_',
          ownerOnlyIssuance: true,
          accessModes: ['assigned', 'workspace'],
          defaultAccessMode: 'assigned',
          workspaceOnlyCapabilities: ['workstream.manage', ...workspaceCommandScopes],
        },
        mcp: {
          path: '/mcp',
          transport: 'stateless Streamable HTTP',
          tools: {
            query: { name: 'accord_query', recommendedArguments: { includeHistory: false } },
            attention: { name: 'accord_attention', arguments: {} },
          },
          mutationArguments: ['input', 'idempotencyKey'],
          resultEncoding: 'JSON in text content blocks; check isError and protocol errors',
        },
        rest: {
          state: '/api/v1/state?history=none',
          attention: '/api/v1/attention',
          openapi: '/docs/openapi.json',
          upload: '/api/v1/evidence/upload',
        },
        docs: {
          index: '/llms.txt',
          full: '/llms-full.txt',
          human: '/help/user-guide.html',
          agent: '/docs/agent-guide.md',
          examples: '/docs/examples.json',
        },
        constraints: {
          idempotencyKeyPattern: '^[\\w.-]{8,128}$',
          commandBodyMaxBytes: 256000,
          fileMaxBytes: 3145728,
          contactImportMaxBytes: 2097152,
          contactImportMaxRecords: 1000,
          taskReadScope: 'read',
          peopleReadScope: 'people.read',
          independentVerifierScopes: ['read', 'evidence.verify'],
          executionNeedsGrant: true,
          assignmentsLaunchRuntime: false,
          externalEffectsExecutedByAccord: false,
          diagnosticsOwnerOnly: true,
          newApiTaskDefaultCompletionPolicy: 'verified',
          newUiTaskDefaultCompletionPolicy: 'simple',
        },
        commands,
      }),
      { parser: 'json', printWidth: 100 },
    ),
  );
  for (const name of guides) {
    const key = `docs/${name}.md`,
      source = String(outputs.get(key) ?? (await readFile(key, 'utf8')));
    outputs.set(
      `public/docs/${name}.md`,
      source.replaceAll('../examples/agent.ts', '/docs/example-agent.ts'),
    );
    outputs.set(
      `public/help/${name}.html`,
      await format(htmlPage(name, source), { parser: 'html', printWidth: 100 }),
    );
  }
  for (const name of ['openapi.json', 'agent-manifest.json', 'examples.json'])
    outputs.set(
      `public/docs/${name}`,
      outputs.get(`docs/${name}`) ?? (await readFile(`docs/${name}`, 'utf8')),
    );
  outputs.set('public/docs/example-agent.ts', await readFile('examples/agent.ts', 'utf8'));
  outputs.set('public/help/style.css', await readFile('docs/help.css', 'utf8'));
  for (const [pkg, file] of [
    ['manrope', 'manrope-latin-600-normal.woff2'],
    ['ibm-plex-sans', 'ibm-plex-sans-latin-400-normal.woff2'],
    ['ibm-plex-mono', 'ibm-plex-mono-latin-400-normal.woff2'],
  ]) {
    outputs.set(
      `public/help/fonts/${file}`,
      await readFile(`node_modules/@fontsource/${pkg}/files/${file}`),
    );
  }
  for (const pkg of ['manrope', 'ibm-plex-sans', 'ibm-plex-mono']) {
    outputs.set(
      `public/help/fonts/${pkg}-LICENSE.txt`,
      await readFile(`node_modules/@fontsource/${pkg}/LICENSE`, 'utf8'),
    );
  }
  outputs.set(
    'public/llms.txt',
    '# Accord\n\n> A private coordination workspace for one human owner and explicitly authorized agents. Documentation is not authority.\n\n## Start here\n\n- [Agent guide](/docs/agent-guide.md): operational protocol, scopes, retries, and examples.\n- [Human guide](/docs/user-guide.md): screens and daily workflows.\n- [Commands](/docs/commands.md): every command and version target.\n- [OpenAPI](/docs/openapi.json): request schemas and auxiliary endpoints.\n- [Agent manifest](/docs/agent-manifest.json): machine-readable capabilities.\n- [Examples](/docs/examples.json): fictional schema-validated inputs.\n- [Troubleshooting](/docs/troubleshooting.md): diagnosis and recovery.\n- [Full text](/llms-full.txt): consolidated documentation.\n\n## Connection\n\nUse the origin and Accord bearer token supplied by the human. Connect to /mcp with Streamable HTTP. Query with includeHistory=false; read accord_attention before acting. No external action is executed by an Accord command.\n',
  );
  outputs.set(
    'public/llms-full.txt',
    [
      '# Accord consolidated documentation\n\nUse the guides and schemas shipped by the same deployment. No credentials or workspace data are included. Relative Markdown links refer to /docs/.',
      ...guides
        .filter((name) => !['index', 'validation', 'architecture'].includes(name))
        .map(
          (name) =>
            `\n\n---\n\nSource: /docs/${name}.md\n\n${outputs.get(`public/docs/${name}.md`)}`,
        ),
    ].join('\n'),
  );
  return outputs;
}
async function main() {
  const check = process.argv.includes('--check'),
    outputs = await documentationOutputs(),
    stale: string[] = [];
  for (const [path, content] of outputs) {
    if (check) {
      const existing = await readFile(path).catch(() => null);
      if (!existing?.equals(Buffer.from(content))) stale.push(path);
    } else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
  }
  if (stale.length)
    throw new Error(
      `Generated documentation is stale. Run npm run docs:generate.\n${stale.join('\n')}`,
    );
  console.log(`${check ? 'Checked' : 'Generated'} ${outputs.size} documentation artifacts.`);
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
