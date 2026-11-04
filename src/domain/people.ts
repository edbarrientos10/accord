import { canAccessRecord, hasWorkspaceAccess } from './access';
import { randomUUID } from 'node:crypto';
import type { Actor, Entity, State, Person, Commitment } from './types';
import { assert } from './errors';
import {
  defaultGroups,
  minimalPerson,
  otherGroupId,
  peopleSchemas,
  type Person as Profile,
} from './people-schema';
import { peopleQueue } from './people-presentation';
export const peopleCollections = [
  'people',
  'relationshipGroups',
  'interactions',
  'importantDates',
  'commitments',
  'peopleResponses',
] as const;
export function normalizePeople(s: State): State {
  s.timezone ??= 'America/Monterrey';
  s.relationshipGroups ??= defaultGroups();
  s.people ??= [];
  s.interactions ??= [];
  s.importantDates ??= [];
  s.commitments ??= [];
  s.peopleResponses ??= [];
  return s;
}
export function peopleRecords(s: State) {
  return peopleCollections.flatMap((k) => (s[k] ?? []) as Entity[]);
}
export function canReadPeople(a: Actor) {
  return a.kind === 'human' || a.scopes.includes('people.read');
}
export function applyPeople(
  s: State,
  a: Actor,
  name: string,
  input: unknown,
  now: string,
): Entity | { id: string } {
  assert(name in peopleSchemas, 'unknown_command', 'Unknown command');
  assert(
    name === 'workspace.timezone' || canReadPeople(a),
    'forbidden',
    'People read permission is required.',
    403,
  );
  const base = () => ({ id: randomUUID(), version: 1, createdAt: now, updatedAt: now });
  const check = <T extends Entity>(list: T[], id: string, expected?: number): T => {
    const v = list.find((x) => x.id === id);
    assert(v, 'not_found', 'Record not found.', 404);
    if (expected !== undefined)
      assert(v.version === expected, 'conflict', 'Reload this record before changing it.', 409);
    return v;
  };
  const touch = (v: Entity) => {
    v.version++;
    v.updatedAt = now;
  };
  const human = () =>
    assert(
      a.kind === 'human',
      'human_required',
      'Only the human may change completion requirements or waive commitments.',
      403,
    );
  const person = (id: string) => check(s.people, id);
  const validatePerson = (p: Person) => {
    check(s.relationshipGroups, p.groupId);
    assert(
      p.cadenceMode !== 'custom' || p.cadenceDays,
      'validation',
      'Custom cadence needs a number of days.',
    );
  };
  const validateCommitment = (c: Commitment, old?: Commitment) => {
    person(c.personId);
    assert(
      s.identities.some((i) => i.id === c.coordinatorId && ['human', 'agent'].includes(i.kind)),
      'validation',
      'Choose a human or agent coordinator.',
    );
    if (c.required !== (old?.required ?? false)) human();
    if (old?.required && old.workstreamId !== c.workstreamId) human();
    assert(
      !c.required || c.workstreamId,
      'validation',
      'Required commitments must link to a task.',
    );
    if (c.workstreamId) {
      const w = check(s.workstreams, c.workstreamId);
      if (!old || old.workstreamId !== c.workstreamId)
        assert(
          canAccessRecord(a, w),
          'forbidden',
          'Task assignment is required to link work.',
          403,
        );
      assert(
        !c.projectId || c.projectId === w.projectId,
        'validation',
        'Choose the linked task’s project.',
      );
      if (c.required && !['fulfilled', 'waived'].includes(c.status))
        assert(
          w.status !== 'completed',
          'invalid_transition',
          'Reopen the task before adding or reopening required work.',
          409,
        );
    }
    if (c.projectId) {
      check(s.projects, c.projectId);
      if (!old || c.projectId !== old.projectId)
        assert(
          a.kind === 'human' ||
            hasWorkspaceAccess(a) ||
            s.workstreams.some((w) => w.projectId === c.projectId && canAccessRecord(a, w)),
          'forbidden',
          'Project context requires an assigned task.',
          403,
        );
    }
  };
  // Each command has already been validated by the shared command schema.
  switch (name) {
    case 'workspace.timezone': {
      const p = peopleSchemas['workspace.timezone'].parse(input);
      human();
      assert(s.revision === p.expectedVersion, 'conflict', 'Reload workspace settings.', 409);
      const before = s.timezone;
      s.timezone = p.timezone;
      s.audit.push({
        id: randomUUID(),
        actorId: a.id,
        at: now,
        command: name,
        entityId: s.workspaceId,
        reason: p.reason,
        changes: { before, after: p.timezone },
      });
      return { id: s.workspaceId };
    }
    case 'person.import': {
      const p = peopleSchemas['person.import'].parse(input);
      assert(!p.entityId || p.expectedVersion, 'validation', 'Updates require a reviewed version.');
      const profile = Object.fromEntries(
        Object.entries(p.profile).filter(
          ([, v]) => v !== '' && (!Array.isArray(v) || v.length > 0),
        ),
      );
      const result = applyPeople(
        s,
        a,
        p.entityId ? 'person.update' : 'person.create',
        p.entityId
          ? {
              ...profile,
              entityId: p.entityId,
              expectedVersion: p.expectedVersion,
              reason: p.reason,
            }
          : { ...profile, reason: p.reason },
        now,
      ) as Profile;
      if (p.birthday) {
        const b = p.birthday;
        const existing = s.importantDates.filter(
          (d) => d.personId === result.id && d.kind === 'birthday',
        );
        assert(
          !existing.length || b.entityId,
          'conflict',
          'Review the existing birthday before importing.',
          409,
        );
        if (b.entityId)
          assert(
            existing.some((d) => d.id === b.entityId),
            'validation',
            'Birthday belongs to another contact.',
          );
        applyPeople(
          s,
          a,
          b.entityId ? 'important_date.update' : 'important_date.create',
          {
            personId: result.id,
            title: 'Birthday',
            kind: 'birthday',
            month: b.month,
            day: b.day,
            year: b.year,
            annual: true,
            ...(b.entityId ? { entityId: b.entityId, expectedVersion: b.expectedVersion } : {}),
            reason: p.reason,
          },
          now,
        );
      }
      return result;
    }
    case 'person.create': {
      const { reason, ...p } = peopleSchemas['person.create'].parse(input);
      const v = { ...base(), ...p, groupId: p.groupId ?? otherGroupId };
      validatePerson(v);
      s.people.push(v);
      s.identities.push({ id: v.id, name: v.name, kind: 'third_party' });
      return v;
    }
    case 'person.update': {
      const { entityId, expectedVersion, reason, ...patch } =
        peopleSchemas['person.update'].parse(input);
      const v = check(s.people, entityId, expectedVersion);
      Object.assign(v, patch);
      validatePerson(v);
      s.identities.find((i) => i.id === v.id)!.name = v.name;
      touch(v);
      return v;
    }
    case 'relationship_group.create': {
      const { reason, ...p } = peopleSchemas['relationship_group.create'].parse(input);
      assert(
        !s.relationshipGroups.some((g) => g.name.toLowerCase() === p.name.toLowerCase()),
        'validation',
        'A group already uses this name.',
      );
      const v = { ...base(), ...p };
      s.relationshipGroups.push(v);
      return v;
    }
    case 'relationship_group.update': {
      const { entityId, expectedVersion, reason, ...p } =
        peopleSchemas['relationship_group.update'].parse(input);
      const v = check(s.relationshipGroups, entityId, expectedVersion);
      assert(
        !p.name ||
          !s.relationshipGroups.some(
            (g) => g.id !== v.id && g.name.toLowerCase() === p.name!.toLowerCase(),
          ),
        'validation',
        'A group already uses this name.',
      );
      Object.assign(v, p);
      touch(v);
      return v;
    }
    case 'interaction.log': {
      const { reason, ...p } = peopleSchemas['interaction.log'].parse(input);
      person(p.personId);
      assert(
        Date.parse(p.occurredAt) <= Date.parse(now),
        'validation',
        'An interaction must already have occurred.',
      );
      const v = { ...base(), ...p, actorId: a.id };
      s.interactions.push(v);
      return v;
    }
    case 'interaction.correct': {
      const { entityId, expectedVersion, reason, ...p } =
        peopleSchemas['interaction.correct'].parse(input);
      const v = check(s.interactions, entityId, expectedVersion);
      Object.assign(v, p);
      person(v.personId);
      assert(
        Date.parse(v.occurredAt) <= Date.parse(now),
        'validation',
        'An interaction must already have occurred.',
      );
      touch(v);
      return v;
    }
    case 'important_date.create':
    case 'important_date.update': {
      let v;
      if (name === 'important_date.create') {
        const { reason, ...p } = peopleSchemas['important_date.create'].parse(input);
        v = { ...base(), ...p };
        s.importantDates.push(v);
      } else {
        const { entityId, expectedVersion, reason, ...p } =
          peopleSchemas['important_date.update'].parse(input);
        v = check(s.importantDates, entityId, expectedVersion);
        Object.assign(v, p);
        touch(v);
      }
      person(v.personId);
      const year = v.year ?? 2000;
      const d = new Date(
        `${String(year).padStart(4, '0')}-${String(v.month).padStart(2, '0')}-${String(v.day).padStart(2, '0')}T12:00:00Z`,
      );
      assert(
        d.getUTCMonth() + 1 === v.month && d.getUTCDate() === v.day,
        'validation',
        'Invalid calendar date.',
      );
      assert(v.annual || v.year, 'validation', 'One-time dates require a year.');
      assert(v.kind !== 'birthday' || v.annual, 'validation', 'Birthdays repeat annually.');
      return v;
    }
    case 'commitment.create': {
      const { reason, ...p } = peopleSchemas['commitment.create'].parse(input);
      const v = { ...base(), ...p, status: 'requested' as const, note: '' };
      validateCommitment(v);
      s.commitments.push(v);
      return v;
    }
    case 'commitment.update': {
      const { entityId, expectedVersion, reason, ...p } =
        peopleSchemas['commitment.update'].parse(input);
      const v = check(s.commitments, entityId, expectedVersion);
      const old = structuredClone(v);
      Object.assign(v, p);
      validateCommitment(v, old);
      touch(v);
      return v;
    }
    case 'commitment.transition': {
      const p = peopleSchemas['commitment.transition'].parse(input);
      const v = check(s.commitments, p.entityId, p.expectedVersion);
      if (p.status === 'waived') human();
      assert(p.status !== v.status, 'invalid_transition', 'Choose a different state.', 409);
      const terminal = ['fulfilled', 'declined', 'cancelled', 'waived'];
      assert(
        !terminal.includes(v.status) || ['requested', 'committed'].includes(p.status),
        'invalid_transition',
        'Reopen this commitment before changing its result.',
        409,
      );
      assert(
        p.status !== 'fulfilled' || ['committed', 'reported_done'].includes(v.status),
        'invalid_transition',
        'Record an agreed commitment or reported result first.',
        409,
      );
      const old = structuredClone(v);
      v.status = p.status;
      v.note = p.note;
      validateCommitment(v, old);
      touch(v);
      return v;
    }
    case 'people_reminder.respond': {
      const p = peopleSchemas['people_reminder.respond'].parse(input);
      const q = peopleQueue(s, Date.parse(now)).find(
        (q) => q.subjectId === p.entityId && q.occurrenceKey === p.occurrenceKey,
      );
      assert(q, 'not_found', 'This reminder is no longer current.', 404);
      assert(q.version === p.expectedVersion, 'conflict', 'Reload this reminder.', 409);
      assert(
        p.response !== 'acknowledged' || q.category === 'occasion',
        'validation',
        'Log an interaction or resolve the commitment instead.',
      );
      assert(
        p.response !== 'snoozed' || (p.until && Date.parse(p.until) > Date.parse(now)),
        'validation',
        'Choose a future snooze time.',
      );
      let r = s.peopleResponses.find((r) => r.occurrenceKey === p.occurrenceKey);
      const values = {
        subjectId: p.entityId,
        subjectVersion: p.expectedVersion,
        occurrenceKey: p.occurrenceKey,
        response: p.response,
        until: p.response === 'snoozed' ? p.until : null,
        actorId: a.id,
      };
      if (r) {
        Object.assign(r, values);
        touch(r);
      } else {
        r = { ...base(), ...values };
        s.peopleResponses.push(r);
      }
      return r;
    }
  }
  throw new Error('Unknown People command');
}
