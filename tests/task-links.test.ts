import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fixture, MemoryRepository } from './helpers';
import { schemas } from '../src/domain/commands';
import { visibleState } from '../src/domain/service';
import { execute } from '../src/server/repository';
import { makeArchive, validateArchive, prepareRestore } from '../src/server/export';
import type { Workstream } from '../src/domain/types';

const resource = () => ({
  id: randomUUID(),
  title: 'Delivery notes',
  url: 'https://example.com/notes',
  note: 'For review',
});

describe('task links', () => {
  it('creates links, preserves omitted lists, and lets assigned agents edit and remove with audit history', () => {
    const f = fixture(),
      link = resource();
    const w = f.command('workstream.create', {
      title: 'Linked task',
      outcome: 'Deliver notes',
      ownerId: f.human.id,
      assignedAgentIds: [f.agent.id],
      completionPolicy: 'simple',
      criteria: [],
      nextAction: null,
      links: [{ ...link, title: '  Delivery notes  ' }],
      reason: 'Create with resource',
    }) as Workstream;
    f.agent.assignments.push(w.id);
    expect(w.links).toEqual([link]);
    const patch = (data: object) =>
      f.command(
        'workstream.update',
        {
          entityId: w.id,
          expectedVersion: f.current(w.id).version,
          reason: 'Maintain resources',
          ...data,
        },
        f.agent,
      );
    patch({ reportedProgress: 'Prepared' });
    expect(f.current(w.id).links).toEqual([link]);
    const second = resource();
    patch({ links: [link, second] });
    patch({ links: [{ ...link, title: 'Final notes', note: undefined }, second] });
    expect(f.current(w.id).links[0]).toEqual({ id: link.id, title: 'Final notes', url: link.url });
    patch({ links: [second] });
    expect(f.current(w.id).links).toEqual([second]);
    expect(f.state.audit.at(-1)).toMatchObject({
      actorId: f.agent.id,
      command: 'workstream.update',
      entityId: w.id,
      changes: {
        before: { links: [{ ...link, title: 'Final notes', note: undefined }, second] },
        after: { links: [second] },
      },
    });
    patch({ links: [] });
    expect(f.current(w.id).links).toEqual([]);
    expect(f.state.evidence).toEqual([]);
    expect(f.current(w.id).references).toEqual([]);
  });

  it('rejects invalid URLs, blank/oversized text, duplicate IDs, and extra fields', () => {
    const input = { entityId: randomUUID(), expectedVersion: 1, reason: 'Validate' },
      link = resource();
    for (const patch of [
      { url: 'javascript:alert(1)' },
      { url: 'data:text/html,example' },
      { url: 'ftp://example.com' },
      { url: '/relative' },
      { url: 'not a URL' },
      { title: '  ' },
      { title: 'x'.repeat(10001) },
      { note: '' },
      { note: 'x'.repeat(10001) },
      { id: 'invalid' },
      { unexpected: true },
    ])
      expect(
        schemas['workstream.update'].safeParse({ ...input, links: [{ ...link, ...patch }] })
          .success,
      ).toBe(false);
    expect(schemas['workstream.update'].safeParse({ ...input, links: [link, link] }).success).toBe(
      false,
    );
    expect(
      schemas['workstream.update'].safeParse({
        ...input,
        links: [{ ...link, url: 'http://example.com' }],
      }).success,
    ).toBe(true);
  });

  it('enforces access, scope, stale versions and terminal task rules; retries do not duplicate changes', async () => {
    const f = fixture(),
      w = f.create(),
      repo = new MemoryRepository(f.state);
    const input = {
      entityId: w.id,
      expectedVersion: w.version,
      links: [resource()],
      reason: 'Add resource',
    };
    for (const actor of [
      { ...f.agent, scopes: ['read'] },
      { ...f.agent, assignments: [] },
    ])
      await expect(
        execute(repo, actor, 'workstream.update', input, randomUUID()),
      ).rejects.toMatchObject({ status: 403 });
    repo.state.workstreams[0].assignedAgentIds = [];
    await expect(
      execute(repo, f.agent, 'workstream.update', input, randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
    repo.state.workstreams[0].assignedAgentIds = [f.agent.id];
    const first = await execute(repo, f.agent, 'workstream.update', input, 'task-link-retry');
    const auditCount = repo.state.audit.length;
    expect(await execute(repo, f.agent, 'workstream.update', input, 'task-link-retry')).toEqual(
      first,
    );
    expect(repo.state.audit).toHaveLength(auditCount);
    expect(repo.state.workstreams[0].links).toEqual(input.links);
    await expect(
      execute(repo, f.agent, 'workstream.update', input, 'stale-task-links'),
    ).rejects.toMatchObject({ code: 'conflict' });
    for (const status of ['completed', 'cancelled', 'dismissed'] as const) {
      repo.state.workstreams[0].status = status;
      await expect(
        execute(repo, f.human, 'workstream.update', { ...input, expectedVersion: 2 }, randomUUID()),
      ).rejects.toMatchObject({ code: 'invalid_transition' });
    }
  });

  it('normalizes legacy tasks without mutation or unrelated audit events and round-trips links through archives', async () => {
    const f = fixture(),
      w = f.create(),
      other = f.create();
    for (const task of f.state.workstreams) delete (task as Partial<Workstream>).links;
    const before = JSON.stringify(f.state),
      count = f.state.audit.length;
    expect(
      visibleState(f.state, f.agent).workstreams.every((task) => task.links.length === 0),
    ).toBe(true);
    expect(JSON.stringify(f.state)).toBe(before);
    f.command('workstream.update', {
      entityId: w.id,
      expectedVersion: w.version,
      reportedProgress: 'Legacy update',
      reason: 'Update old task',
    });
    expect(f.current(w.id).links).toEqual([]);
    expect(f.current(other.id).links).toEqual([]);
    expect(f.state.audit).toHaveLength(count + 1);
    const legacy = await makeArchive(f.state, [], true);
    delete (legacy.state.workstreams[0] as Partial<Workstream>).links;
    expect(validateArchive(legacy).state.workstreams[0].links).toEqual([]);
    const link = resource();
    f.command('workstream.update', {
      entityId: w.id,
      expectedVersion: f.current(w.id).version,
      links: [link],
      reason: 'Add resource',
    });
    const archive = validateArchive(await makeArchive(f.state, [w.id]));
    expect(archive.state.workstreams[0].links).toEqual([link]);
    const target = fixture();
    target.state.identities = target.state.identities.filter((i) => i.kind === 'human');
    expect(prepareRestore(archive, target.state).workstreams[0].links).toEqual([link]);
    archive.state.workstreams[0].links[0].url = 'javascript:alert(1)';
    expect(() => validateArchive(archive)).toThrow();
  });
});
