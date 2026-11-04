import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture, MemoryRepository } from './helpers';
import { applyCommand, visibleState } from '../src/domain/service';
import { execute } from '../src/server/repository';
import { peopleScopes } from '../src/domain/permissions';
import { decisionQueue } from '../src/domain/presentation';
import { peopleQueue, nextContactDate } from '../src/domain/people-presentation';
import { scopedExport, validateArchive, prepareRestore } from '../src/server/export';
import type { Person, Commitment, ImportantDate, Interaction } from '../src/domain/types';
const reason = 'Test relationship workflow';
const base = (v: { id: string; version: number }) => ({
  entityId: v.id,
  expectedVersion: v.version,
  reason,
});
function setup() {
  const f = fixture();
  const p = f.command('person.create', {
    name: 'Jamie',
    notes: 'Private note',
    emails: [{ label: 'Home', value: 'jamie@example.com' }],
    reason,
  }) as Person;
  const actor = { ...f.agent, scopes: ['people.read', ...peopleScopes], assignments: [] };
  return { f, p, actor };
}
describe('People domain and privacy', () => {
  it('creates one linked identity and patches only supplied profile fields', () => {
    const { f, p } = setup();
    expect(f.state.identities.find((i) => i.id === p.id)?.kind).toBe('third_party');
    const v = f.command('person.update', { ...base(p), name: 'Jamie Rivera' }) as Person;
    expect(v.notes).toBe('Private note');
    expect(v.emails).toHaveLength(1);
    expect(f.state.identities.find((i) => i.id === p.id)?.name).toBe(v.name);
    const count = f.state.audit.length;
    f.create();
    expect(f.state.audit.length).toBe(count + 1);
    expect(() => f.command('person.update', { ...base(p), name: 'Stale' })).toThrow(/Reload/);
  });
  it('keeps People access independent of task assignments and rejects implicit grants', () => {
    const { f, p, actor } = setup();
    const w = f.create();
    expect(visibleState(f.state, f.agent).people).toEqual([]);
    expect(() =>
      f.command('person.update', { ...base(p), name: 'No permission' }, f.agent),
    ).toThrow(/scope/i);
    const c = f.command('commitment.create', {
      personId: p.id,
      title: 'Return draft',
      direction: 'waiting_on',
      coordinatorId: f.agent.id,
      workstreamId: w.id,
      reason,
    }) as Commitment;
    const visible = visibleState(f.state, actor);
    expect(visible.workstreams).toEqual([]);
    expect(visible.commitments[0].workstreamId).toBeNull();
    expect(visible.people[0].notes).toBe('Private note');
    expect(() =>
      f.command(
        'commitment.create',
        {
          personId: p.id,
          title: 'Hidden task',
          direction: 'waiting_on',
          coordinatorId: f.agent.id,
          workstreamId: w.id,
          reason,
        },
        actor,
      ),
    ).toThrow(/assignment/);
    expect(() => visibleState(f.state, { ...actor, workspaceId: randomUUID() })).toThrow(
      /Workspace/,
    );
    expect(c.required).toBe(false);
  });
  it.each(['simple', 'verified'] as const)(
    'gates required commitments for %s completion',
    (completionPolicy) => {
      const { f, p, actor } = setup();
      const w = f.create();
      f.command('workstream.update', { ...base(w), completionPolicy });
      let c = f.command('commitment.create', {
        personId: p.id,
        title: 'Deliver contract',
        direction: 'waiting_on',
        coordinatorId: f.agent.id,
        workstreamId: w.id,
        required: true,
        reason,
      }) as Commitment;
      const close = () =>
        f.command('workstream.close', {
          ...base(f.current(w.id)),
          evidenceIds: [],
          humanConfirmation: 'I accept every criterion',
        });
      expect(() =>
        f.command(
          'workstream.close',
          { ...base(f.current(w.id)), evidenceIds: [] },
          { ...f.agent, assignments: [] },
        ),
      ).toThrow(/assignment/);
      expect(close).toThrow(/commitments/);
      expect(() => f.command('commitment.update', { ...base(c), required: false }, actor)).toThrow(
        /human/,
      );
      expect(() =>
        f.command(
          'commitment.transition',
          { ...base(c), status: 'waived', note: 'Cannot waive', reason },
          actor,
        ),
      ).toThrow(/human/);
      c = f.command(
        'commitment.transition',
        { ...base(c), status: 'committed', note: 'They agreed' },
        actor,
      ) as Commitment;
      c = f.command(
        'commitment.transition',
        { ...base(c), status: 'reported_done', note: 'They reported delivery' },
        actor,
      ) as Commitment;
      expect(close).toThrow(/commitments/);
      c = f.command(
        'commitment.transition',
        { ...base(c), status: 'fulfilled', note: 'Checked delivery' },
        actor,
      ) as Commitment;
      expect(f.current(w.id).status).toBe('open');
      close();
      expect(f.current(w.id).status).toBe('completed');
      if (completionPolicy === 'simple') expect(f.current(w.id).verifiedAt).toBeNull();
      expect(() =>
        f.command(
          'commitment.transition',
          { ...base(c), status: 'committed', note: 'Reopen' },
          actor,
        ),
      ).toThrow(/Reopen the task/);
    },
  );
  it('supports both directions, archive retention, informational links and attributable transitions', () => {
    const { f, p, actor } = setup();
    const w = f.create();
    const c = f.command('commitment.create', {
      personId: p.id,
      title: 'Send feedback',
      direction: 'i_owe',
      coordinatorId: f.human.id,
      workstreamId: w.id,
      promisedDate: '2026-10-12',
      reason,
    }) as Commitment;
    f.command('person.update', { ...base(p), status: 'archived' });
    expect(
      peopleQueue(f.state, Date.parse('2026-10-12T12:00:00Z')).some((q) => q.commitmentId === c.id),
    ).toBe(true);
    f.command('workstream.close', { ...base(w), evidenceIds: [], humanConfirmation: 'Accepted' });
    expect(f.current(w.id).status).toBe('completed');
    const changed = f.command(
      'commitment.transition',
      { ...base(c), status: 'cancelled', note: 'No longer needed' },
      actor,
    );
    expect(f.state.audit.some((a) => a.entityId === changed.id && a.actorId === actor.id)).toBe(
      true,
    );
  });
  it('replays authorized imports and hides linked task context from mutation results', async () => {
    const { f, p, actor } = setup();
    const w = f.create();
    const c = f.command('commitment.create', {
      personId: p.id,
      title: 'Deliver',
      direction: 'waiting_on',
      coordinatorId: f.agent.id,
      workstreamId: w.id,
      reason,
    }) as Commitment;
    const repo = new MemoryRepository(f.state);
    const payload = { ...base(c), status: 'committed', note: 'Agreed' };
    const result = await execute(repo, actor, 'commitment.transition', payload, 'people-retry-key');
    expect(result).toMatchObject({ workstreamId: null, status: 'committed' });
    expect(
      await execute(repo, actor, 'commitment.transition', payload, 'people-retry-key'),
    ).toEqual(result);
    await expect(
      execute(
        repo,
        { ...actor, scopes: ['commitment.transition'] },
        'commitment.transition',
        payload,
        'people-retry-key',
      ),
    ).rejects.toThrow();
  });
  it('imports a profile and birthday atomically; never clears fields with empty import values', () => {
    const { f, p } = setup();
    const imported = f.command('person.import', {
      entityId: p.id,
      expectedVersion: p.version,
      profile: { name: 'Jamie', notes: '', emails: [] },
      birthday: { month: 2, day: 29, year: null },
      reason,
    }) as Person;
    expect(imported.notes).toBe('Private note');
    expect(imported.emails).toHaveLength(1);
    expect(f.state.importantDates).toHaveLength(1);
    const revision = f.state.revision;
    expect(() =>
      f.command('person.import', {
        entityId: p.id,
        expectedVersion: imported.version,
        profile: { name: 'Bad date' },
        birthday: { month: 2, day: 30, year: 2026 },
        reason,
      }),
    ).toThrow();
    expect(f.state.revision).toBe(revision);
    expect(f.state.people[0].name).toBe('Jamie');
  });
});
describe('Relationship reminders', () => {
  it('resets group cadence only for qualifying interactions, supports correction, override and pause', () => {
    const { f, p } = setup();
    let v = f.command('person.update', {
      ...base(p),
      groupId: f.state.relationshipGroups[0].id,
    }) as Person;
    expect(nextContactDate(f.state, p.id)).toBe('2026-11-11');
    f.command('interaction.log', {
      personId: p.id,
      occurredAt: '2026-10-01T12:00:00Z',
      channel: 'email',
      summary: 'One-way update',
      meaningful: false,
      reason,
    });
    expect(nextContactDate(f.state, p.id)).toBe('2026-11-11');
    let i = f.command('interaction.log', {
      personId: p.id,
      occurredAt: '2026-10-10T12:00:00Z',
      channel: 'call',
      summary: 'Caught up',
      meaningful: true,
      reason,
    }) as Interaction;
    expect(nextContactDate(f.state, p.id)).toBe('2026-11-09');
    f.command('interaction.correct', { ...base(i), voided: true });
    expect(nextContactDate(f.state, p.id)).toBe('2026-11-11');
    v = f.command('person.update', { ...base(v), cadenceMode: 'custom', cadenceDays: 7 }) as Person;
    expect(nextContactDate(f.state, p.id)).toBe('2026-10-19');
    f.command('person.update', { ...base(v), cadenceMode: 'paused' });
    expect(nextContactDate(f.state, p.id)).toBeNull();
  });
  it('separates advance and day-of reminders, yearly occurrences and unknown birth years', () => {
    const { f, p } = setup();
    const d = f.command('important_date.create', {
      personId: p.id,
      title: 'Birthday',
      kind: 'birthday',
      month: 1,
      day: 2,
      year: null,
      advance: true,
      reason,
    }) as ImportantDate;
    let state = f.state;
    const respond = (at: string) => {
      const q = peopleQueue(state, Date.parse(at))[0];
      state = applyCommand(
        state,
        f.human,
        'people_reminder.respond',
        {
          entityId: q.subjectId,
          expectedVersion: q.version,
          occurrenceKey: q.occurrenceKey,
          response: 'acknowledged',
          reason,
        },
        at,
      ).state;
    };
    expect(peopleQueue(state, Date.parse('2026-12-25T18:00:00Z'))).toHaveLength(0);
    respond('2026-12-26T18:00:00Z');
    expect(peopleQueue(state, Date.parse('2027-01-01T18:00:00Z'))).toHaveLength(0);
    expect(peopleQueue(state, Date.parse('2027-01-02T18:00:00Z'))[0].occurrenceKey).toContain(
      ':day',
    );
    respond('2027-01-02T18:00:00Z');
    expect(peopleQueue(state, Date.parse('2027-01-02T20:00:00Z'))).toHaveLength(0);
    expect(peopleQueue(state, Date.parse('2028-01-02T18:00:00Z'))).toHaveLength(1);
    expect(d.year).toBeNull();
  });
  it('uses workspace timezone, leap-day rules and version-aware snoozing', () => {
    const { f, p } = setup();
    const d = f.command('important_date.create', {
      personId: p.id,
      title: 'Birthday',
      kind: 'birthday',
      month: 2,
      day: 29,
      year: null,
      reason,
    }) as ImportantDate;
    expect(peopleQueue(f.state, Date.parse('2027-02-28T05:00:00Z'))).toHaveLength(0);
    const now = '2027-02-28T18:00:00Z';
    const q = peopleQueue(f.state, Date.parse(now))[0];
    expect(q).toBeTruthy();
    const state = applyCommand(
      f.state,
      f.human,
      'people_reminder.respond',
      {
        entityId: d.id,
        expectedVersion: d.version,
        occurrenceKey: q.occurrenceKey,
        response: 'snoozed',
        until: '2027-02-28T22:00:00Z',
        reason,
      },
      now,
    ).state;
    expect(peopleQueue(state, Date.parse(now))[0].snoozedUntil).toBeTruthy();
    expect(peopleQueue(state, Date.parse('2027-02-28T23:00:00Z'))[0].snoozedUntil).toBeUndefined();
    expect(peopleQueue(state, Date.parse('2028-02-28T18:00:00Z'))).toHaveLength(0);
    expect(peopleQueue(state, Date.parse('2028-02-29T18:00:00Z'))).toHaveLength(1);
  });
  it.each(['dismissed', 'cancelled'] as const)(
    'keeps linked reminders out of Today after a task is %s, until reopened',
    (disposition) => {
      const { f, p } = setup();
      const w = f.create();
      f.command('commitment.create', {
        personId: p.id,
        title: 'Delivery',
        direction: 'waiting_on',
        coordinatorId: f.human.id,
        workstreamId: w.id,
        promisedDate: '2020-01-01',
        reason,
      });
      expect(decisionQueue(f.state).some((q) => q.taskId === w.id)).toBe(true);
      f.command('workstream.terminate', { ...base(f.current(w.id)), disposition });
      expect(f.current(w.id).status).toBe(disposition);
      expect(decisionQueue(f.state).some((q) => q.taskId === w.id)).toBe(false);
      expect(f.state.commitments[0].status).toBe('requested');
      f.command('workstream.reopen', base(f.current(w.id)));
      expect(decisionQueue(f.state).some((q) => q.taskId === w.id)).toBe(true);
    },
  );
  it('deduplicates linked commitment reasons into one task queue item', () => {
    const { f, p } = setup();
    const w = f.create();
    for (let n = 0; n < 2; n++)
      f.command('commitment.create', {
        personId: p.id,
        title: 'Delivery ' + n,
        direction: 'waiting_on',
        coordinatorId: f.human.id,
        workstreamId: w.id,
        promisedDate: '2026-10-12',
        followUpAt: '2026-10-12T00:00:00Z',
        reason,
      });
    const q = decisionQueue(f.state, Date.parse('2026-10-12T18:00:00Z')).filter(
      (q) => q.taskId === w.id,
    );
    expect(q).toHaveLength(1);
    expect(q[0].peopleItems).toHaveLength(2);
    expect(q[0].peopleItems?.[0].reasons).toHaveLength(2);
  });
});
describe('People archives', () => {
  it('roundtrips v3 and keeps scoped exports free of relationship notes', () => {
    const { f, p } = setup();
    const w = f.create();
    f.command('commitment.create', {
      personId: p.id,
      title: 'Delivery',
      direction: 'waiting_on',
      coordinatorId: f.human.id,
      workstreamId: w.id,
      reason,
    });
    const subset = scopedExport(f.state, [w.id]);
    expect(subset.people[0].notes).toBe('');
    expect(subset.people[0].emails).toEqual([]);
    expect(subset.commitments).toHaveLength(1);
    f.state.identities = f.state.identities.map(({ authUserId, ...i }) => i);
    const archive = validateArchive({
      format: 'accord.v3',
      exportedAt: new Date().toISOString(),
      state: f.state,
      files: [],
    });
    expect(archive.state.people[0].notes).toBe('Private note');
    const target = fixture().state;
    target.identities = target.identities.slice(0, 1);
    const restored = prepareRestore(archive, target);
    expect(restored.commitments[0].coordinatorId).toBe(target.identities[0].id);
    expect(restored.people[0].id).toBe(p.id);
    for (const format of ['accord.v1', 'accord.v2']) {
      const legacy = { ...f.state };
      delete (legacy as Partial<typeof legacy>).people;
      expect(
        validateArchive({ format, exportedAt: new Date().toISOString(), state: legacy, files: [] })
          .format,
      ).toBe('accord.v3');
    }
  });
});
