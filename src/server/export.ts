import { minimalPerson, defaultGroups } from '../domain/people-schema';
import { peopleRecords } from '../domain/people';
import { normalizeTaskLinks } from '../domain/task-links';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { State } from '../domain/types';
import { assert } from '../domain/errors';
import { admin } from './supabase';
import { archiveStateSchema } from '../domain/state-schema';
export interface Archive {
  format: 'accord.v3';
  exportedAt: string;
  state: State;
  files: { path: string; sha256: string; base64: string }[];
}
export function scopedExport(state: State, ids: string[]): State {
  state = normalizeTaskLinks(state);
  assert(
    ids.length > 0 &&
      ids.every(
        (id) =>
          (state.projects ?? []).some((p) => p.id === id) ||
          state.workstreams.some((w) => w.id === id) ||
          state.operations.some((o) => o.id === id),
      ),
    'validation',
    'Choose existing workstreams or operations.',
  );
  const selected = new Set(ids);
  for (const w of state.workstreams)
    if (w.projectId && selected.has(w.projectId)) selected.add(w.id);
  for (const o of state.operations.filter((o) => selected.has(o.id)))
    for (const i of o.incidents) selected.add(i.workstreamId);
  const belongs = (e: { workstreamId?: string; operationId?: string }) =>
    selected.has(e.workstreamId ?? e.operationId ?? '');
  const workstreams = state.workstreams.filter((w) => selected.has(w.id)),
    operations = state.operations.filter((o) => selected.has(o.id)),
    actions = state.actions.filter(belongs),
    grants = state.grants.filter(belongs),
    executions = state.executions.filter(belongs),
    evidence = state.evidence.filter(belongs);
  const projects = (state.projects ?? []).filter(
    (p) => selected.has(p.id) || workstreams.some((w) => w.projectId === p.id),
  );
  const decisions = (state.decisions ?? []).filter((d) => selected.has(d.workstreamId));
  const reminders = (state.reminders ?? []).filter(
    (r) => selected.has(r.subjectId) || actions.some((a) => a.id === r.subjectId),
  );
  const entityIds = new Set(
    [
      ...workstreams,
      ...operations,
      ...actions,
      ...grants,
      ...executions,
      ...evidence,
      ...projects,
      ...decisions,
      ...reminders,
    ].map((e) => e.id),
  );
  const linkedCommitments = (state.commitments ?? []).filter(
    (c) => c.workstreamId && selected.has(c.workstreamId),
  );
  for (const c of linkedCommitments) entityIds.add(c.id);
  const audit = state.audit.filter((a) => entityIds.has(a.entityId));
  const identityIds = new Set<string>();
  state.identities.forEach((i) => {
    if (
      i.kind === 'human' ||
      JSON.stringify({
        workstreams,
        operations,
        actions,
        grants,
        executions,
        evidence,
        audit,
      }).includes(i.id)
    )
      identityIds.add(i.id);
  });
  const commitments = (state.commitments ?? []).filter(
    (c) => c.workstreamId && selected.has(c.workstreamId),
  );
  for (const c of commitments) {
    identityIds.add(c.personId);
    identityIds.add(c.coordinatorId);
  }
  const people = (state.people ?? [])
    .filter((p) => commitments.some((c) => c.personId === p.id))
    .map((p) => minimalPerson(p.id, p.name, p.createdAt));
  return {
    ...state,
    people,
    relationshipGroups: defaultGroups(),
    interactions: [],
    importantDates: [],
    peopleResponses: [],
    commitments,
    identities: state.identities
      .filter((i) => identityIds.has(i.id))
      .map(({ authUserId, ...i }) => i),
    workstreams,
    operations,
    actions,
    grants,
    executions,
    evidence,
    projects,
    decisions,
    reminders,
    audit,
  };
}
export async function makeArchive(s: State, ids: string[], complete = false): Promise<Archive> {
  s = normalizeTaskLinks(s);
  const state = complete
      ? { ...structuredClone(s), identities: s.identities.map(({ authUserId, ...i }) => i) }
      : scopedExport(s, ids),
    files: Archive['files'] = [];
  for (const e of state.evidence) {
    if (!e.storagePath) continue;
    const { data, error } = await admin().storage.from('evidence').download(e.storagePath);
    assert(
      !error && data,
      'export_failed',
      'An evidence file could not be read. Export was not completed.',
      503,
    );
    const buffer = Buffer.from(await data.arrayBuffer()),
      sha256 = createHash('sha256').update(buffer).digest('hex');
    assert(
      sha256 === e.sha256,
      'integrity_failure',
      'Evidence checksum does not match. Export was not completed.',
      409,
    );
    files.push({ path: e.storagePath, sha256, base64: buffer.toString('base64') });
  }
  return { format: 'accord.v3', exportedAt: new Date().toISOString(), state, files };
}
const archiveSchema = z
  .object({
    format: z.enum(['accord.v1', 'accord.v2', 'accord.v3']),
    exportedAt: z.string().datetime({ offset: true }),
    state: archiveStateSchema,
    files: z.array(
      z
        .object({
          path: z.string(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          base64: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export function validateArchive(input: unknown): Archive {
  const a = { ...archiveSchema.parse(input), format: 'accord.v3' } as Archive,
    s = a.state;
  for (const i of s.identities)
    if (i.kind === 'third_party' && !s.people.some((p) => p.id === i.id))
      s.people.push(minimalPerson(i.id, i.name, a.exportedAt));
  for (const p of s.people)
    assert(
      s.identities.some((i) => i.id === p.id && i.kind === 'third_party') &&
        s.relationshipGroups.some((g) => g.id === p.groupId),
      'validation',
      'Invalid contact relationship.',
    );
  for (const r of [...s.interactions, ...s.importantDates, ...s.commitments])
    assert(
      s.people.some((p) => p.id === r.personId),
      'validation',
      'Missing contact.',
    );
  for (const i of s.interactions)
    assert(
      s.identities.some((a) => a.id === i.actorId && a.kind !== 'third_party'),
      'validation',
      'Invalid interaction actor.',
    );
  for (const c of s.commitments)
    assert(
      s.identities.some((i) => i.id === c.coordinatorId && ['human', 'agent'].includes(i.kind)) &&
        (!c.workstreamId || s.workstreams.some((w) => w.id === c.workstreamId)) &&
        (!c.projectId || s.projects.some((p) => p.id === c.projectId)) &&
        (!c.required || c.workstreamId),
      'validation',
      'Invalid commitment relationship.',
    );
  for (const p of s.people)
    assert(p.cadenceMode !== 'custom' || p.cadenceDays, 'validation', 'Invalid contact cadence.');
  for (const d of s.importantDates) {
    const date = new Date(
      `${String(d.year ?? 2000).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}T12:00:00Z`,
    );
    assert(
      date.getUTCMonth() + 1 === d.month &&
        date.getUTCDate() === d.day &&
        (d.annual || d.year) &&
        (d.kind !== 'birthday' || d.annual),
      'validation',
      'Invalid important date.',
    );
  }
  for (const c of s.commitments)
    assert(
      !c.required ||
        ['fulfilled', 'waived'].includes(c.status) ||
        !s.workstreams.some((w) => w.id === c.workstreamId && w.status === 'completed'),
      'validation',
      'Completed task has unresolved required commitments.',
    );
  for (const r of s.peopleResponses)
    assert(
      [...s.people, ...s.importantDates, ...s.commitments].some((p) => p.id === r.subjectId) &&
        s.identities.some((i) => i.id === r.actorId && i.kind !== 'third_party'),
      'validation',
      'Invalid People reminder.',
    );
  assert(
    s.identities.filter((i) => i.kind === 'human').length === 1,
    'validation',
    'An archive needs exactly one human owner.',
  );
  const parents = new Set([...s.workstreams, ...s.operations].map((x) => x.id)),
    identities = new Set(s.identities.map((i) => i.id)),
    actions = new Set(s.actions.map((a) => a.id)),
    grants = new Set(s.grants.map((g) => g.id)),
    executions = new Set(s.executions.map((e) => e.id));
  const workIds = new Set(s.workstreams.map((w) => w.id)),
    opIds = new Set(s.operations.map((o) => o.id));
  const all = [
    ...s.workstreams,
    ...s.operations,
    ...s.actions,
    ...s.grants,
    ...s.executions,
    ...s.evidence,
    ...s.projects,
    ...s.decisions,
    ...s.reminders,
    ...peopleRecords(s),
  ];
  assert(new Set(all.map((x) => x.id)).size === all.length, 'validation', 'Duplicate record IDs.');
  for (const e of [...s.actions, ...s.grants, ...s.executions, ...s.evidence])
    assert(
      e.workstreamId
        ? workIds.has(e.workstreamId)
        : 'operationId' in e && Boolean(e.operationId) && opIds.has(e.operationId!),
      'validation',
      'Archive has a missing parent.',
    );
  for (const d of s.decisions) {
    assert(
      s.workstreams.some((w) => w.id === d.workstreamId) &&
        (d.subjectId === d.workstreamId ||
          s.actions.some((a) => a.id === d.subjectId && a.workstreamId === d.workstreamId)) &&
        s.identities.some((i) => i.id === d.actorId && i.kind === 'human'),
      'validation',
      'Invalid decision relationship.',
    );
  }
  for (const r of s.reminders)
    assert(
      [...s.workstreams, ...s.actions, ...s.operations].some((e) => e.id === r.subjectId) &&
        s.identities.some((i) => i.id === r.actorId && i.kind === 'human'),
      'validation',
      'Invalid reminder relationship.',
    );
  for (const w of s.workstreams) {
    assert(
      !w.projectId || s.projects.some((p) => p.id === w.projectId),
      'validation',
      'Task project is missing.',
    );
    assert(
      w.completionPolicy === 'simple' || w.criteria.length > 0,
      'validation',
      'Verified tasks require criteria.',
    );
    assert(
      identities.has(w.ownerId) &&
        w.assignedAgentIds.every((id) => identities.has(id)) &&
        (!w.nextAction || identities.has(w.nextAction.ownerId)),
      'validation',
      'Archive has a missing identity.',
    );
  }
  for (const o of s.operations)
    assert(
      identities.has(o.ownerId) &&
        o.assignedAgentIds.every((id) => identities.has(id)) &&
        o.incidents.every((i) => workIds.has(i.workstreamId)) &&
        (!o.grantId || grants.has(o.grantId)) &&
        (!o.latestExecutionId || executions.has(o.latestExecutionId)) &&
        (!o.latestVerifiedExecutionId || executions.has(o.latestVerifiedExecutionId)),
      'validation',
      'Archive has a missing operation dependency.',
    );
  for (const g of s.grants)
    assert(
      identities.has(g.granteeId) &&
        s.identities.some((i) => i.id === g.approvedBy && i.kind === 'human') &&
        (!g.actionId ||
          s.actions.some((a) => a.id === g.actionId && a.workstreamId === g.workstreamId)),
      'validation',
      'Archive has a missing grant dependency.',
    );
  for (const a of s.actions)
    assert(
      !a.supersedesId ||
        s.actions.some((x) => x.id === a.supersedesId && x.workstreamId === a.workstreamId),
      'validation',
      'Archive has a missing action revision.',
    );
  for (const event of s.audit)
    assert(identities.has(event.actorId), 'validation', 'Archive has a missing audit actor.');
  for (const e of s.executions)
    assert(
      grants.has(e.grantId) &&
        identities.has(e.actorId) &&
        (!e.actionId || actions.has(e.actionId)),
      'validation',
      'Archive has a missing execution dependency.',
    );
  for (const e of s.evidence) {
    assert(
      identities.has(e.submittedBy) && (!e.executionId || executions.has(e.executionId)),
      'validation',
      'Archive has a missing evidence dependency.',
    );
    if (e.executionId) {
      const execution = s.executions.find((x) => x.id === e.executionId)!;
      assert(
        execution.workstreamId === e.workstreamId && execution.operationId === e.operationId,
        'validation',
        'Evidence execution belongs to a different parent.',
      );
    }
    if (e.verification !== 'unverified')
      assert(
        e.verifiedAt &&
          s.identities.some(
            (i) =>
              i.id === e.verifiedBy &&
              i.kind === (e.verification === 'accepted' ? 'human' : 'integration'),
          ),
        'validation',
        'Trusted evidence is missing an attributable verifier.',
      );
    if (e.storagePath) {
      const f = a.files.find((f) => f.path === e.storagePath);
      assert(
        f &&
          f.sha256 === e.sha256 &&
          createHash('sha256').update(Buffer.from(f.base64, 'base64')).digest('hex') === f.sha256,
        'integrity_failure',
        'Evidence file is missing or corrupt.',
      );
      assert(
        e.storagePath.startsWith(`${s.workspaceId}/${e.workstreamId ?? e.operationId}/`),
        'validation',
        'Evidence object path is outside its parent.',
      );
    }
  }
  assert(
    a.files.every((f) => s.evidence.some((e) => e.storagePath === f.path)),
    'validation',
    'Archive has unregistered files.',
  );
  return a;
}
export function prepareRestore(archive: Archive, target: State): State {
  assert(
    (target.relationshipGroups ?? []).every((g) =>
      defaultGroups().some(
        (d) =>
          d.id === g.id && d.name === g.name && d.cadenceDays === g.cadenceDays && g.version === 1,
      ),
    ) &&
      !(target.people ?? []).length &&
      !(target.interactions ?? []).length &&
      !(target.commitments ?? []).length &&
      !(target.importantDates ?? []).length &&
      !(target.peopleResponses ?? []).length &&
      !(target.projects ?? []).length &&
      !(target.decisions ?? []).length &&
      !(target.reminders ?? []).length &&
      !target.workstreams.length &&
      !target.operations.length &&
      !target.actions.length &&
      !target.grants.length &&
      !target.executions.length &&
      !target.evidence.length &&
      target.identities.length === 1,
    'destination_not_empty',
    'Restore requires an empty, bootstrapped installation.',
    409,
  );
  const oldHuman = archive.state.identities.find((i) => i.kind === 'human')!,
    newHuman = target.identities.find((i) => i.kind === 'human')!;
  const map = (v: unknown): unknown =>
    typeof v === 'string'
      ? v === oldHuman.id
        ? newHuman.id
        : v === archive.state.workspaceId
          ? target.workspaceId
          : v.startsWith(`${archive.state.workspaceId}/`)
            ? `${target.workspaceId}/${v.slice(archive.state.workspaceId.length + 1)}`
            : v
      : Array.isArray(v)
        ? v.map(map)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, map(x)]))
          : v;
  const state = map(archive.state) as State;
  state.workspaceId = target.workspaceId;
  state.revision = target.revision + 1;
  state.identities = state.identities.map((i) =>
    i.kind === 'human' ? { ...i, authUserId: newHuman.authUserId } : i,
  );
  state.audit = [
    ...target.audit,
    ...state.audit,
    {
      id: randomUUID(),
      actorId: newHuman.id,
      at: new Date().toISOString(),
      command: 'workspace.restore',
      entityId: newHuman.id,
      reason:
        'Restored a validated archive into an empty installation. Owner ID was mapped to this installation; credentials were excluded.',
      changes: { sourceWorkspaceId: archive.state.workspaceId, exportedAt: archive.exportedAt },
    },
  ];
  return state;
}
