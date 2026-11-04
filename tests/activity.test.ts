import { describe, expect, it } from 'vitest';
import {
  activityEntries,
  activityChanges,
  filterActivity,
  inspectable,
} from '../src/domain/activity';
import { visibleState } from '../src/domain/service';
import { execute } from '../src/server/repository';
import { fixture, MemoryRepository } from './helpers';

describe('activity inspector', () => {
  it('inspects scalar workspace changes and credential event metadata', () => {
    const f = fixture();
    f.create();
    const event = f.state.audit[0];
    expect(
      activityChanges({
        ...event,
        command: 'workspace.timezone',
        changes: { before: 'America/Monterrey', after: 'UTC' },
      }),
    ).toEqual([{ key: 'timezone', before: 'America/Monterrey', after: 'UTC' }]);
    expect(
      activityChanges({
        ...event,
        command: 'credential.revoke',
        changes: { credentialId: 'credential-reference' },
      }),
    ).toEqual([{ key: 'credentialId', before: undefined, after: 'credential-reference' }]);
  });
  it('shows saved agent changes with their original reason and field differences', () => {
    const f = fixture(),
      w = f.create();
    f.command(
      'workstream.update',
      {
        entityId: w.id,
        expectedVersion: w.version,
        reportedProgress: 'Draft prepared',
        reason: 'Reviewed source notes',
      },
      f.agent,
    );
    const entry = filterActivity(activityEntries(f.state), {}, f.state.timezone)[0];
    expect(entry.actorName).toBe('Fictional agent');
    expect(entry.href).toBe(`/tasks/${w.id}`);
    expect(entry.outcome).toBe('recorded');
    expect(entry.event.reason).toBe('Reviewed source notes');
    expect(activityChanges(entry.event)).toEqual([
      { key: 'reportedProgress', before: 'No progress reported', after: 'Draft prepared' },
    ]);
  });
  it('retains historical execution outcomes after later reconciliation', () => {
    const f = fixture(),
      w = f.create();
    const id = crypto.randomUUID();
    f.state.executions.push({
      id,
      version: 2,
      createdAt: '2026-10-26T05:00:00Z',
      updatedAt: '2026-10-26T06:00:00Z',
      workstreamId: w.id,
      grantId: crypto.randomUUID(),
      actorId: f.agent.id,
      state: 'succeeded',
      result: 'Later lookup succeeded',
      evidenceIds: [],
    });
    f.state.audit.push({
      id: crypto.randomUUID(),
      actorId: f.agent.id,
      at: '2026-10-26T05:00:00Z',
      command: 'execution.report',
      entityId: id,
      reason: 'Provider timed out',
      changes: { before: { state: 'running' }, after: { state: 'uncertain' } },
    });
    const entries = activityEntries(f.state);
    expect(
      filterActivity(
        entries,
        { outcome: 'uncertain', from: '2026-10-25', to: '2026-10-25' },
        'America/Monterrey',
      ),
    ).toHaveLength(1);
    expect(filterActivity(entries, { outcome: 'succeeded' }, f.state.timezone)).toHaveLength(0);
    expect(
      filterActivity(
        entries,
        { command: 'execution.report', query: 'Provider timed out' },
        f.state.timezone,
      )[0].title,
    ).toBe(w.title);
  });
  it('uses only authorized state and keeps redacted People history redacted', () => {
    const f = fixture(),
      w = f.create();
    f.create();
    f.agent.assignments = [w.id];
    const scoped = activityEntries(visibleState(f.state, f.agent));
    expect(scoped.every((e) => e.event.entityId === w.id)).toBe(true);
    const event = { ...f.state.audit[0], changes: { redacted: true } };
    expect(activityChanges(event)).toEqual([]);
    expect(
      inspectable({ authUserId: 'private', nested: { access_token: 'secret', label: 'safe' } }),
    ).toEqual({ nested: { label: 'safe' } });
  });
  it('does not turn idempotent retries or rejected commands into new saved-change events', async () => {
    const f = fixture(),
      w = f.create(),
      repo = new MemoryRepository(f.state);
    const input = {
      entityId: w.id,
      expectedVersion: w.version,
      reportedProgress: 'Prepared',
      reason: 'Progress',
    };
    await execute(repo, f.agent, 'workstream.update', input, 'activity-retry');
    const count = repo.state.audit.length;
    await execute(repo, f.agent, 'workstream.update', input, 'activity-retry');
    expect(repo.state.audit).toHaveLength(count);
    await expect(
      execute(repo, f.agent, 'workstream.update', input, 'activity-stale'),
    ).rejects.toThrow();
    expect(repo.state.audit).toHaveLength(count);
  });
});
