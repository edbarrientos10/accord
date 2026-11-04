'use client';
import { RecordActivity } from './record-activity';
import { ArrowUpRight, Paperclip } from 'lucide-react';
import type { Workstream, Operation, Action, Execution, Evidence, Grant } from '../../domain/types';
import type { Field } from '../forms';
import { useWorkspace } from './context';
import { fmt, datetime, iso, str, lines, reason } from './helpers';
import { Empty } from './ui';
export function useActions() {
  const { state, demo, request, reload, setNotice, setForm } = useWorkspace();
  const who = (id?: string) => state?.identities.find((i) => i.id === id)?.name ?? 'Unassigned';
  const human = state?.identities.find((i) => i.kind === 'human');
  const people = (kinds?: string[]) =>
    state?.identities
      .filter((i) => !kinds || kinds.includes(i.kind))
      .map((i) => ({ value: i.id, label: `${i.name} · ${i.kind.replace('_', ' ')}` })) ?? [];
  const ownerField = (value?: string): Field => ({
    name: 'ownerId',
    label: 'Task owner',
    type: 'select',
    value: value ?? human?.id,
    options: people(['human', 'agent']),
  });
  const assignmentField = (value: string[] = []): Field => ({
    name: 'assignedAgentIds',
    label: 'Assigned agents',
    type: 'multiselect',
    value,
    required: false,
    options: people(['agent']),
    hint: 'Select the agents collaborating on this task. Credentials also require explicit assignments.',
  });
  const nextFields = (w?: Workstream): Field[] => [
    { name: 'nextText', label: 'Next action', value: w?.nextAction?.text ?? '', required: false },
    {
      name: 'nextOwner',
      label: 'Next-action owner',
      type: 'select',
      value: w?.nextAction?.ownerId ?? human?.id,
      options: people(),
    },
    {
      name: 'dependency',
      label: 'Dependency',
      value: w?.nextAction?.dependency ?? '',
      required: false,
    },
    {
      name: 'requiredAuthority',
      label: 'Required authority',
      value: w?.nextAction?.requiredAuthority ?? '',
      required: false,
    },
  ];
  const next = (f: FormData) =>
    str(f, 'nextText')
      ? {
          text: str(f, 'nextText'),
          ownerId: str(f, 'nextOwner'),
          ...(str(f, 'dependency') ? { dependency: str(f, 'dependency') } : {}),
          ...(str(f, 'requiredAuthority')
            ? { requiredAuthority: str(f, 'requiredAuthority') }
            : {}),
        }
      : null;
  const mutate = async (name: string, input: unknown, key: string) => {
    await request(`/api/v1/commands/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(input),
    });
    await reload();
    setNotice('Saved.');
  };
  const open = (
    title: string,
    name: string,
    fields: Field[],
    input: (f: FormData) => unknown,
    description?: string,
    submit = 'Save change',
  ) => {
    if (demo) {
      setNotice(
        'This preview uses fictional, read-only data. Install Accord to create your workspace.',
      );
      return;
    }
    let previousPayload = '',
      retryKey = '',
      cachedInput: unknown;
    setForm({
      title,
      description,
      fields,
      submit,
      run: async (f) => {
        const serialized = JSON.stringify(Array.from(f.entries()));
        if (serialized !== previousPayload) {
          const nextInput = input(f);
          previousPayload = serialized;
          retryKey = crypto.randomUUID();
          cachedInput = nextInput;
        }
        await mutate(name, cachedInput, retryKey);
      },
    });
  };
  const base = (entity: { id: string; version: number }, f: FormData) => ({
    entityId: entity.id,
    expectedVersion: entity.version,
    reason: str(f, 'reason') || 'Updated from the workspace',
  });
  const editWork = (w: Workstream) =>
    open(
      'Update outcome and next action',
      'workstream.update',
      [
        { name: 'title', label: 'Task title', value: w.title },
        { name: 'outcome', label: 'Desired outcome', type: 'textarea', value: w.outcome },
        ownerField(w.ownerId),
        assignmentField(w.assignedAgentIds),
        ...nextFields(w),
        {
          name: 'reportedProgress',
          label: 'Reported progress',
          type: 'textarea',
          value: w.reportedProgress,
        },
        {
          name: 'reviewAt',
          label: 'Review by',
          type: 'datetime-local',
          value: datetime(w.reviewAt),
        },
        reason,
      ],
      (f) => ({
        ...base(w, f),
        title: str(f, 'title'),
        outcome: str(f, 'outcome'),
        ownerId: str(f, 'ownerId'),
        assignedAgentIds: f.getAll('assignedAgentIds'),
        nextAction: next(f),
        reportedProgress: str(f, 'reportedProgress'),
        reviewAt: iso(f, 'reviewAt'),
      }),
    );
  const close = (w: Workstream) =>
    open(
      'Accept completion',
      'workstream.close',
      [
        {
          name: 'humanConfirmation',
          label: 'Your acceptance of the closure criteria',
          type: 'textarea',
          hint: 'Explain what establishes achievement of every criterion. Your confirmation is recorded as human acceptance.',
        },
        reason,
      ],
      (f) => ({
        ...base(w, f),
        humanConfirmation: str(f, 'humanConfirmation'),
        evidenceIds: state!.evidence
          .filter((e) => e.workstreamId === w.id && e.verification !== 'unverified')
          .map((e) => e.id),
      }),
      w.criteria.map((c) => `• ${c.text}`).join('\n'),
      'Accept completion',
    );
  const propose = (w: Workstream, a?: Action) =>
    open(
      a ? 'Revise proposed action' : 'Propose a bounded action',
      'action.propose',
      [
        { name: 'operation', label: 'Operation', value: a?.operation ?? 'send_email' },
        { name: 'effect', label: 'Intended effect', type: 'textarea', value: a?.effect },
        { name: 'target', label: 'Recipient or system', value: a?.target },
        { name: 'content', label: 'Exact content', type: 'textarea', value: a?.content },
        { name: 'scope', label: 'Scope and limits', type: 'textarea', value: a?.scope },
        {
          name: 'expiresAt',
          label: 'Approval valid until',
          type: 'datetime-local',
          value: datetime(),
        },
        {
          name: 'declaredCost',
          label: 'Declared cost',
          type: 'number',
          value: String(a?.declaredCost ?? 0),
          hint: 'This is a declared estimate, not verified external spending.',
        },
        { name: 'currency', label: 'Currency', value: a?.currency ?? 'USD' },
        reason,
      ],
      (f) => ({
        workstreamId: w.id,
        expectedVersion: w.version,
        ...(a ? { supersedesId: a.id } : {}),
        operation: str(f, 'operation'),
        effect: str(f, 'effect'),
        target: str(f, 'target'),
        content: str(f, 'content'),
        scope: str(f, 'scope'),
        expiresAt: iso(f, 'expiresAt'),
        declaredCost: Number(f.get('declaredCost')),
        currency: str(f, 'currency'),
        reason: str(f, 'reason') || 'Updated from the workspace',
      }),
    );
  const attach = (entity: Workstream | Operation, file = false) => {
    const parent = state!.workstreams.some((w) => w.id === entity.id)
      ? { workstreamId: entity.id }
      : { operationId: entity.id };
    const fields: Field[] = [
      { name: 'title', label: 'Evidence title' },
      { name: 'description', label: 'What this establishes', type: 'textarea' },
      { name: 'provenance', label: 'Source and provenance' },
      ...(file
        ? [
            {
              name: 'file',
              label: 'Private evidence file',
              type: 'file',
              hint: 'Up to 3 MiB. Stored privately; downloads expire after 60 seconds.',
            } as Field,
          ]
        : [{ name: 'url', label: 'Reference URL', required: false }]),
      {
        name: 'executionId',
        label: 'Related execution',
        type: 'select',
        required: false,
        options: state!.executions
          .filter((e) => e.workstreamId === entity.id || e.operationId === entity.id)
          .map((e) => ({ value: e.id, label: `${e.state} · ${fmt(e.createdAt)}` })),
      },
      ...('criteria' in entity
        ? [
            {
              name: 'criterionIds',
              label: 'Closure criteria supported',
              type: 'multiselect',
              required: false,
              options: entity.criteria.map((c) => ({ value: c.id, label: c.text })),
            } as Field,
          ]
        : []),
      reason,
    ];
    const input = (f: FormData) => ({
      ...parent,
      expectedVersion: entity.version,
      title: str(f, 'title'),
      description: str(f, 'description'),
      provenance: str(f, 'provenance'),
      criterionIds: f.getAll('criterionIds'),
      ...(str(f, 'executionId') ? { executionId: str(f, 'executionId') } : {}),
      ...(!file && str(f, 'url') ? { url: str(f, 'url') } : {}),
      reason: str(f, 'reason') || 'Updated from the workspace',
    });
    if (!file) {
      open(
        'Attach evidence',
        'evidence.attach',
        fields,
        input,
        'Evidence begins unverified. Acceptance is a separate decision.',
      );
      return;
    }
    if (demo) {
      setNotice('The fictional preview cannot upload private evidence.');
      return;
    }
    const uploadKey = crypto.randomUUID();
    setForm({
      title: 'Upload private evidence',
      fields,
      submit: 'Upload evidence',
      run: async (f) => {
        const data = new FormData();
        data.set('file', f.get('file')!);
        data.set('metadata', JSON.stringify(input(f)));
        await request('/api/v1/evidence/upload', {
          method: 'POST',
          headers: { 'Idempotency-Key': uploadKey },
          body: data,
        });
        await reload();
      },
    });
  };
  const standing = (entity: Workstream | Operation) =>
    open(
      'Grant recurring permission',
      'grant.standing',
      [
        {
          name: 'granteeId',
          label: 'Identity receiving authority',
          type: 'select',
          options: people(['human', 'agent']),
        },
        {
          name: 'operations',
          label: 'Allowed operations',
          type: 'textarea',
          hint: 'Exact operation names, one per line.',
        },
        {
          name: 'targets',
          label: 'Allowed targets',
          type: 'textarea',
          hint: 'Exact recipients or systems, one per line.',
        },
        {
          name: 'validFrom',
          label: 'Valid from',
          type: 'datetime-local',
          value: datetime(new Date().toISOString()),
        },
        { name: 'expiresAt', label: 'Expires at', type: 'datetime-local', value: datetime() },
        { name: 'maxUses', label: 'Maximum attempts', type: 'number', value: '1' },
        { name: 'costLimit', label: 'Declared cost limit', type: 'number', required: false },
        { name: 'currency', label: 'Currency', value: 'USD' },
        reason,
      ],
      (f) => ({
        ...('criteria' in entity ? { workstreamId: entity.id } : { operationId: entity.id }),
        expectedVersion: entity.version,
        granteeId: str(f, 'granteeId'),
        operations: lines(f, 'operations'),
        targets: lines(f, 'targets'),
        validFrom: iso(f, 'validFrom'),
        expiresAt: iso(f, 'expiresAt'),
        maxUses: Number(f.get('maxUses')),
        ...(str(f, 'costLimit') ? { costLimit: Number(f.get('costLimit')) } : {}),
        currency: str(f, 'currency'),
        reason: str(f, 'reason') || 'Updated from the workspace',
      }),
      'Permission authorizes the listed scope until expiration or revocation. It does not establish that an external action happened.',
    );
  const actionCard = (a: Action) => {
    const grants = state!.grants.filter((g) => g.actionId === a.id && !g.revokedAt),
      superseded = state!.actions.some((x) => x.supersedesId === a.id),
      w = state!.workstreams.find((w) => w.id === a.workstreamId)!;
    return (
      <article className="action-card" key={a.id}>
        <div className="row-between">
          <span className="badge">Revision {a.revision}</span>
          <span className="muted">
            {superseded
              ? 'Superseded'
              : grants.length
                ? 'Authorized'
                : a.approvalRequested
                  ? 'Approval requested'
                  : 'Proposed'}
          </span>
        </div>
        <h3>{a.effect}</h3>
        <dl>
          <dt>Operation</dt>
          <dd>{a.operation}</dd>
          <dt>Target</dt>
          <dd>{a.target}</dd>
          <dt>Scope</dt>
          <dd>{a.scope}</dd>
          <dt>Expires</dt>
          <dd>{fmt(a.expiresAt)}</dd>
          <dt>Declared cost</dt>
          <dd>
            {a.declaredCost} {a.currency}
          </dd>
        </dl>
        <details>
          <summary>Review exact content</summary>
          <pre>{a.content}</pre>
        </details>
        {!superseded && (
          <div className="button-row">
            <button className="button secondary small" onClick={() => propose(w, a)}>
              Revise
            </button>
            {!a.approvalRequested && !state.decisions.some((d) => d.subjectId === a.id) && (
              <button
                className="button secondary small"
                onClick={() =>
                  open('Request approval', 'action.request_approval', [reason], (f) => base(a, f))
                }
              >
                Request approval
              </button>
            )}
            {a.approvalRequested &&
              !grants.length &&
              !state.decisions.some((d) => d.subjectId === a.id) && (
                <button
                  className="button small"
                  onClick={() =>
                    open(
                      'Approve this action revision',
                      'grant.approve',
                      [
                        {
                          name: 'granteeId',
                          label: 'Who may execute this action?',
                          type: 'select',
                          options: people(['human', 'agent']),
                        },
                        reason,
                      ],
                      (f) => ({ ...base(a, f), granteeId: str(f, 'granteeId') }),
                      `${a.effect}\nTarget: ${a.target}\nContent:\n${a.content}\nScope: ${a.scope}\nDeclared cost: ${a.declaredCost} ${a.currency}`,
                      'Approve revision',
                    )
                  }
                >
                  Review & approve
                </button>
              )}
            {grants.some((g) => g.granteeId === human?.id && g.used < g.maxUses) && (
              <button
                className="button small"
                onClick={() =>
                  open(
                    'Record an attempt starting',
                    'execution.start',
                    [reason],
                    (f) => ({
                      actionId: a.id,
                      expectedVersion: a.version,
                      grantId: grants.find((g) => g.granteeId === human?.id)!.id,
                      reason: str(f, 'reason') || 'Updated from the workspace',
                    }),
                    'This reserves the approval. Perform the external action in its own system, then report the result.',
                  )
                }
              >
                Start attempt
              </button>
            )}
          </div>
        )}
      </article>
    );
  };
  const executionCard = (e: Execution) => (
    <article className="compact-card" key={e.id}>
      <div className="row-between">
        <h3>{e.state.replaceAll('_', ' ')}</h3>
        <span className="badge">
          {e.verifiedAt ? 'Result evidence accepted' : 'Unverified result'}
        </span>
      </div>
      <p>{e.result}</p>
      {e.externalId && <p className="muted">External identifier: {e.externalId}</p>}
      <p className="muted">
        {who(e.actorId)} · {fmt(e.updatedAt)}
      </p>
      {e.state === 'running' && (
        <button
          className="button secondary small"
          onClick={() =>
            open(
              'Report observed result',
              'execution.report',
              [
                {
                  name: 'state',
                  label: 'Observed result',
                  type: 'select',
                  options: ['succeeded', 'partial', 'failed', 'uncertain'].map((v) => ({
                    value: v,
                    label: v,
                  })),
                },
                { name: 'result', label: 'Result and remaining work', type: 'textarea' },
                { name: 'externalId', label: 'External identifier', required: false },
                ...(e.operationId
                  ? [
                      {
                        name: 'incidentKey',
                        label: 'Incident key (required for failures)',
                        required: false,
                      },
                    ]
                  : []),
                reason,
              ],
              (f) => ({
                ...base(e, f),
                state: str(f, 'state'),
                result: str(f, 'result'),
                ...(str(f, 'externalId') ? { externalId: str(f, 'externalId') } : {}),
                ...(str(f, 'incidentKey') ? { incidentKey: str(f, 'incidentKey') } : {}),
              }),
            )
          }
        >
          Report result
        </button>
      )}
      {(e.state === 'uncertain' || e.state === 'running') && (
        <button
          className="button secondary small"
          onClick={() =>
            open(
              'Reconcile this attempt',
              'execution.reconcile',
              [
                {
                  name: 'state',
                  label: 'Established result',
                  type: 'select',
                  options: ['succeeded', 'partial', 'failed'].map((v) => ({ value: v, label: v })),
                },
                { name: 'result', label: 'Established result', type: 'textarea' },
                {
                  name: 'evidenceIds',
                  label: 'Accepted evidence',
                  type: 'multiselect',
                  options: state!.evidence
                    .filter((x) => x.executionId === e.id && x.verification !== 'unverified')
                    .map((x) => ({ value: x.id, label: x.title })),
                },
                reason,
              ],
              (f) => ({
                ...base(e, f),
                state: str(f, 'state'),
                result: str(f, 'result'),
                evidenceIds: f.getAll('evidenceIds'),
              }),
            )
          }
        >
          Reconcile
        </button>
      )}
    </article>
  );
  const evidenceCard = (e: Evidence) => (
    <article className="compact-card" key={e.id}>
      <div className="row-between">
        <h3>{e.title}</h3>
        <span className={`badge ${e.verification === 'unverified' ? 'amber' : 'green'}`}>
          {e.verification === 'accepted' ? 'Human accepted' : e.verification}
        </span>
      </div>
      <p>{e.description}</p>
      <p className="muted">
        Source: {e.provenance} · {who(e.submittedBy)}
      </p>
      {e.verifiedAt && (
        <p className="muted">
          Accepted by {who(e.verifiedBy)} · {fmt(e.verifiedAt)} · {e.verificationNote}
        </p>
      )}
      <div className="button-row">
        {e.url && (
          <a className="text-link" href={e.url} target="_blank" rel="noreferrer">
            Open reference <ArrowUpRight size={14} />
          </a>
        )}
        {e.storagePath && (
          <button
            className="text-link"
            onClick={async () => {
              try {
                const d = await request(`/api/v1/evidence/${e.id}/download`);
                window.open(d.url, '_blank', 'noopener,noreferrer');
              } catch (err) {
                setNotice((err as Error).message);
              }
            }}
          >
            Download private file
          </button>
        )}
        {e.verification === 'unverified' ? (
          <button
            className="button secondary small"
            onClick={() =>
              open(
                'Accept this evidence',
                'evidence.verify',
                [{ name: 'note', label: 'What you verified', type: 'textarea' }, reason],
                (f) => ({ ...base(e, f), note: str(f, 'note') }),
                e.description,
                'Accept evidence',
              )
            }
          >
            Accept evidence
          </button>
        ) : (
          <button
            className="button secondary small"
            onClick={() =>
              open(
                'Correct evidence verification',
                'evidence.invalidate',
                [reason],
                (f) => base(e, f),
                'This preserves the original acceptance in history and reopens completed outcomes for review.',
              )
            }
          >
            Correct verification
          </button>
        )}
      </div>
    </article>
  );
  const grantCard = (g: Grant) => (
    <article className="compact-card" key={g.id}>
      <div className="row-between">
        <h3>{g.type === 'standing' ? 'Standing permission' : 'One-time approval'}</h3>
        <span className="badge">
          {g.revokedAt
            ? 'Revoked'
            : Date.parse(g.expiresAt) < Date.now()
              ? 'Expired'
              : `${g.used}/${g.maxUses} attempts`}
        </span>
      </div>
      <p>
        {who(g.granteeId)} · {g.operations.join(', ')} → {g.targets.join(', ')}
      </p>
      <p className="muted">
        Expires {fmt(g.expiresAt)} · Declared cost used {g.declaredCostUsed} /{' '}
        {g.costLimit ?? 'unlimited'} {g.currency}
      </p>
      {!g.revokedAt && (
        <button
          className="button secondary small"
          onClick={() =>
            open(
              'Revoke authority',
              'grant.revoke',
              [reason],
              (f) => base(g, f),
              'Revocation prevents future attempts. Existing external effects cannot be reversed here.',
              'Revoke',
            )
          }
        >
          Revoke
        </button>
      )}
    </article>
  );
  const activity = (ids: string[]) => <RecordActivity entityId={ids[0]} />;
  const records = (entity: Workstream | Operation) => {
    const id = entity.id,
      actions = state!.actions.filter((a) => a.workstreamId === id),
      executions = state!.executions.filter((e) => e.workstreamId === id || e.operationId === id),
      evidence = state!.evidence.filter((e) => e.workstreamId === id || e.operationId === id),
      grants = state!.grants.filter((g) => g.workstreamId === id || g.operationId === id);
    return (
      <>
        <section className="section">
          <div className="section-title">
            <h2>Evidence</h2>
            <div className="button-row">
              <button className="button secondary small" onClick={() => attach(entity, true)}>
                <Paperclip size={14} />
                Upload file
              </button>
              <button className="button secondary small" onClick={() => attach(entity)}>
                Attach reference
              </button>
            </div>
          </div>
          {evidence.length ? (
            evidence.map(evidenceCard)
          ) : (
            <Empty
              title="No evidence attached"
              text="Attach the sources or confirmations that establish the result."
            />
          )}
        </section>
        {'criteria' in entity && (
          <section className="section">
            <div className="section-title">
              <h2>Proposed actions</h2>
              <button className="button secondary small" onClick={() => propose(entity)}>
                Propose action
              </button>
            </div>
            {actions.length ? (
              actions.map(actionCard)
            ) : (
              <Empty
                title="No actions proposed"
                text="Describe sensitive actions before asking for authority."
              />
            )}
          </section>
        )}
        <section className="section">
          <div className="section-title">
            <h2>Authority</h2>
            <button className="button secondary small" onClick={() => standing(entity)}>
              Grant permission
            </button>
          </div>
          {grants.length ? (
            grants.map(grantCard)
          ) : (
            <p className="muted">No active authority has been granted.</p>
          )}
        </section>
        <section className="section">
          <h2>Executions</h2>
          {executions.length ? (
            executions.map(executionCard)
          ) : (
            <p className="muted">No attempts recorded. Approval alone does not imply execution.</p>
          )}
        </section>
        <section className="section">
          <h2>History</h2>
          {activity([
            id,
            ...actions.map((x) => x.id),
            ...executions.map((x) => x.id),
            ...evidence.map((x) => x.id),
            ...grants.map((x) => x.id),
          ])}
        </section>
      </>
    );
  };

  return {
    who,
    human,
    people,
    ownerField,
    assignmentField,
    nextFields,
    next,
    mutate,
    open,
    base,
    editWork,
    close,
    propose,
    attach,
    standing,
    actionCard,
    executionCard,
    evidenceCard,
    grantCard,
    activity,
    records,
  };
}
