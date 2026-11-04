import { describe, expect, it } from 'vitest';
import { fixture, MemoryRepository } from './helpers';
import { schemas } from '../src/domain/commands';
import { execute } from '../src/server/repository';
import { makeArchive, validateArchive, prepareRestore } from '../src/server/export';

describe('owner profile', () => {
  it('trims details, preserves identity and auth links, audits changes, and clears the role', () => {
    const f = fixture(),
      original = { ...f.state.identities[0] };
    f.command('profile.update', {
      name: '  Jamie Taylor  ',
      role: '  Designer  ',
      expectedVersion: 0,
      reason: 'Personalize',
    });
    expect(f.state.identities[0]).toEqual({ ...original, name: 'Jamie Taylor', role: 'Designer' });
    expect(f.state.audit[0]).toMatchObject({
      actorId: f.human.id,
      entityId: original.id,
      command: 'profile.update',
      changes: { before: original, after: { name: 'Jamie Taylor', role: 'Designer' } },
    });
    f.command('profile.update', {
      name: 'Jamie',
      role: '   ',
      expectedVersion: 1,
      reason: 'Clear role',
    });
    expect(f.state.identities[0].role).toBeUndefined();
    expect(f.state.identities.slice(1)).toHaveLength(2);
  });
  it('rejects blank/oversized details, extra identity targets, stale revisions, agents and integrations', () => {
    const f = fixture(),
      input = { name: 'Jamie', role: '', expectedVersion: 0, reason: 'Edit' };
    for (const patch of [
      { name: '   ' },
      { name: 'x'.repeat(101) },
      { role: 'x'.repeat(101) },
      { entityId: f.agent.id },
    ])
      expect(schemas['profile.update'].safeParse({ ...input, ...patch }).success).toBe(false);
    expect(() => f.command('profile.update', { ...input, expectedVersion: 1 })).toThrow(/Refresh/);
    for (const kind of ['agent', 'integration'] as const) {
      f.state.identities[1].kind = kind;
      expect(() =>
        f.command('profile.update', input, {
          ...f.agent,
          kind,
          scopes: ['*', 'profile.update'],
          accessMode: 'workspace',
        }),
      ).toThrow(/requires the workspace owner/);
    }
    expect(f.state.revision).toBe(0);
  });
  it('replays retries without a second audit event', async () => {
    const f = fixture(),
      repo = new MemoryRepository(f.state);
    const input = { name: 'Jamie', role: 'Designer', expectedVersion: 0, reason: 'Edit' };
    const first = await execute(repo, f.human, 'profile.update', input, 'profile-retry');
    expect(await execute(repo, f.human, 'profile.update', input, 'profile-retry')).toEqual(first);
    expect(repo.state.audit).toHaveLength(1);
    expect(repo.state.revision).toBe(1);
  });
  it('restores profile details and accepts old archives without a role', async () => {
    const f = fixture(),
      target = fixture();
    target.state.identities = target.state.identities.filter((i) => i.kind === 'human');
    const old = await makeArchive(f.state, [], true);
    expect(validateArchive(old).state.identities[0].role).toBeUndefined();
    f.command('profile.update', {
      name: 'Jamie',
      role: 'Designer',
      expectedVersion: 0,
      reason: 'Edit',
    });
    const archive = validateArchive(await makeArchive(f.state, [], true));
    const restored = prepareRestore(archive, target.state);
    expect(restored.identities.find((i) => i.kind === 'human')).toMatchObject({
      name: 'Jamie',
      role: 'Designer',
      authUserId: target.state.identities[0].authUserId,
    });
  });
});
