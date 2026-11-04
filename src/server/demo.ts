import { minimalPerson } from '../domain/people-schema';
import { localDate } from '../domain/people-presentation';
import type { State, Workstream } from '../domain/types';
import { emptyState } from '../domain/types';
const ids = {
  workspace: '00000000-0000-4000-8000-000000000001',
  human: '00000000-0000-4000-8000-000000000002',
  agent: '00000000-0000-4000-8000-000000000003',
  third: '00000000-0000-4000-8000-000000000004',
};
/** Synthetic read-only data. Never copied from a real user's workspace. */
export function demoState(): State {
  const s = emptyState(ids.workspace),
    now = new Date().toISOString();
  s.identities = [
    { id: ids.human, name: 'Alex Morgan', kind: 'human' },
    { id: ids.agent, name: 'Atlas', kind: 'agent' },
    { id: ids.third, name: 'Northstar team', kind: 'third_party' },
  ];
  const items = [
    [
      'Launch the community handbook',
      'A published handbook that new contributors can use independently.',
      'Review the final accessibility checklist',
      ids.human,
      'ready_for_review',
    ],
    [
      'Agree on the studio lease',
      'A signed lease with the agreed terms and move-in date.',
      'Await the revised terms from Northstar',
      ids.third,
      'open',
    ],
    [
      'Prepare the monthly field report',
      'A reviewed report with traceable sources and confirmed delivery.',
      'Compile findings and attach source evidence',
      ids.agent,
      'open',
    ],
    [
      'Restore the research archive',
      'An accessible archive with verified integrity.',
      'Confirm access to the missing source files',
      ids.human,
      'blocked',
    ],
  ];
  s.workstreams = items.map(
    (a, index) =>
      ({
        id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
        version: 1,
        createdAt: now,
        updatedAt: now,
        title: a[0],
        outcome: a[1],
        ownerId: ids.human,
        assignedAgentIds: [ids.agent],
        mode: 'assisted',
        criteria: [
          {
            id: `00000000-0000-4000-8000-${String(index + 30).padStart(12, '0')}`,
            text: 'The agreed result has been accepted and supported by evidence',
          },
        ],
        nextAction: { text: a[2], ownerId: a[3] },
        status: a[4],
        reviewAt: new Date(Date.now() + (index === 3 ? -1 : 7) * 86400000).toISOString(),
        reportedProgress:
          index === 0
            ? 'Draft and checklist submitted for review'
            : 'Latest status reported by Atlas',
        verifiedAt: null,
        blocker:
          index === 3
            ? {
                cause: 'Source access is unavailable',
                attemptedResolution: 'Requested a new access link',
                unblockCondition: 'Owner provides access to the original files',
                resolverId: ids.human,
              }
            : null,
        references: [],
        links: [],
      }) as Workstream,
  );
  const projectId = '00000000-0000-4000-8000-000000000060',
    researchId = '00000000-0000-4000-8000-000000000061';
  s.projects = [
    {
      id: projectId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      name: 'Community launch',
      description: 'Give new contributors a confident first step.',
      targetDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      status: 'active',
    },
    {
      id: researchId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      name: 'Research & insights',
      description: 'Turn field observations into useful, traceable knowledge.',
      targetDate: null,
      status: 'active',
    },
  ];
  for (const [index, w] of s.workstreams.entries()) {
    w.projectId = index < 2 ? projectId : researchId;
    w.completionPolicy = 'verified';
    w.priority = index === 0 ? 'high' : index === 3 ? 'urgent' : 'medium';
    w.planningStage = index === 1 ? 'todo' : 'in_progress';
    w.dueDate = new Date(Date.now() + (index + 2) * 86400000).toISOString().slice(0, 10);
    if (index === 2) w.ownerId = ids.agent;
  }
  s.actions = [
    {
      id: '00000000-0000-4000-8000-000000000070',
      version: 1,
      createdAt: now,
      updatedAt: now,
      workstreamId: s.workstreams[0].id,
      revision: 1,
      operation: 'send_email',
      effect: 'Share the handbook with contributors',
      target: 'Community contributor mailing list',
      content:
        'Hi everyone,\n\nThe community handbook is ready for your review. It brings our contribution guidelines, accessibility checklist, and first-week resources into one place.\n\nPlease read through the draft and send any feedback by Friday. Your input will help make the first contribution easier for everyone.\n\nThanks,\nAlex',
      scope: 'Send this message once to the fictional contributor list.',
      expiresAt: new Date(Date.now() + 3 * 86400000).toISOString(),
      declaredCost: 0,
      currency: 'USD',
      approvalRequested: true,
    },
  ];
  s.evidence = [
    {
      id: '00000000-0000-4000-8000-000000000080',
      version: 1,
      createdAt: now,
      updatedAt: now,
      workstreamId: s.workstreams[0].id,
      criterionIds: s.workstreams[0].criteria.map((c) => c.id),
      title: 'Handbook accessibility checklist',
      description:
        'Fictional review: all sections have headings, descriptive links, and a clear first contribution path.',
      url: 'https://example.com/handbook-checklist',
      provenance: 'Fictional contributor review',
      submittedBy: ids.agent,
      verification: 'unverified',
    },
  ];
  s.workstreams.push({
    ...s.workstreams[2],
    id: '00000000-0000-4000-8000-000000000014',
    title: 'Organize the field notes',
    outcome: 'Group this month’s field notes by theme.',
    status: 'completed',
    criteria: [],
    completionPolicy: 'simple',
    priority: 'low',
    nextAction: null,
    verifiedAt: null,
    closure: { actorId: ids.agent, reason: 'Notes grouped and indexed', evidenceIds: [], at: now },
  });
  s.workstreams.push({
    ...s.workstreams[1],
    id: '00000000-0000-4000-8000-000000000015',
    title: 'Plan the contributor welcome session',
    outcome: 'Outline the agenda for the first welcome session.',
    criteria: [],
    completionPolicy: 'simple',
    priority: 'none',
    nextAction: null,
    planningStage: 'todo',
  });
  s.operations = [
    {
      id: '00000000-0000-4000-8000-000000000050',
      version: 1,
      createdAt: now,
      updatedAt: now,
      title: 'Weekly briefing',
      purpose: 'Keep the team informed with a source-backed briefing',
      ownerId: ids.human,
      assignedAgentIds: [ids.agent],
      cadenceHours: 168,
      expectedAt: now,
      incidents: [],
    },
  ];
  const today = localDate(Date.now(), s.timezone);
  s.people = [
    minimalPerson(ids.third, 'Northstar team', now),
    minimalPerson(
      '00000000-0000-4000-8000-000000000071',
      'Jamie Rivera',
      new Date(Date.now() - 80 * 86400000).toISOString(),
    ),
    minimalPerson('00000000-0000-4000-8000-000000000072', 'Sam Chen', now),
  ];
  s.people[0].organization = 'Northstar Studio';
  s.people[0].groupId = s.relationshipGroups[2].id;
  s.people[1].groupId = s.relationshipGroups[1].id;
  s.people[1].notes = 'Enjoys hiking and community projects. Ask about the new garden.';
  s.people[1].emails = [{ label: 'Personal', value: 'jamie@example.com' }];
  s.people[1].tags = ['outdoors'];
  s.people[2].groupId = s.relationshipGroups[2].id;
  s.people[2].organization = 'Fieldwork Collective';
  s.people[2].role = 'Design lead';
  for (const p of s.people)
    if (!s.identities.some((i) => i.id === p.id))
      s.identities.push({ id: p.id, name: p.name, kind: 'third_party' });
  s.importantDates = [
    {
      id: '00000000-0000-4000-8000-000000000073',
      version: 1,
      createdAt: now,
      updatedAt: now,
      personId: s.people[1].id,
      title: 'Birthday',
      kind: 'birthday',
      month: Number(today.slice(5, 7)),
      day: Number(today.slice(8)),
      year: null,
      annual: true,
      advance: true,
      active: true,
    },
  ];
  s.commitments = [
    {
      id: '00000000-0000-4000-8000-000000000074',
      version: 1,
      createdAt: now,
      updatedAt: now,
      personId: ids.third,
      direction: 'waiting_on',
      title: 'Send the revised studio lease',
      coordinatorId: ids.agent,
      promisedDate: today,
      followUpAt: now,
      priority: 'high',
      source: 'Fictional planning conversation',
      workstreamId: s.workstreams[1].id,
      projectId: null,
      required: false,
      status: 'committed',
      note: 'The team agreed to send revised terms.',
    },
    {
      id: '00000000-0000-4000-8000-000000000075',
      version: 1,
      createdAt: now,
      updatedAt: now,
      personId: s.people[2].id,
      direction: 'i_owe',
      title: 'Share feedback on the workshop outline',
      coordinatorId: ids.human,
      promisedDate: today,
      followUpAt: null,
      priority: 'medium',
      source: 'Fictional meeting',
      workstreamId: null,
      projectId: null,
      required: false,
      status: 'requested',
      note: '',
    },
  ];
  // Fictional historical snapshots for the read-only activity inspector.
  s.audit = [
    ...s.workstreams.map((w, index) => ({
      id: `00000000-0000-4000-8000-${String(90 + index).padStart(12, '0')}`,
      actorId: index === 1 ? ids.human : ids.agent,
      at: new Date(Date.now() - (index + 1) * 3600000).toISOString(),
      command: index === 3 ? 'workstream.block' : 'workstream.update',
      entityId: w.id,
      reason:
        index === 3
          ? 'Source access is missing. Recorded the blocker for review.'
          : 'Record the next step after reviewing the fictional project notes.',
      changes: {
        before: { ...w, nextAction: null, reportedProgress: '' },
        after: structuredClone(w),
      },
    })),
    {
      id: '00000000-0000-4000-8000-000000000094',
      actorId: ids.agent,
      at: new Date(Date.now() - 1800000).toISOString(),
      command: 'commitment.create',
      entityId: s.commitments[0].id,
      reason: 'Track the revised lease promised by the Northstar team.',
      changes: { before: null, after: structuredClone(s.commitments[0]) },
    },
  ];
  return s;
}

export function demoAttempts(
  state: State,
): { actorId: string; event: import('./attempts').CommandAttempt }[] {
  const actorId = state.identities.find((i) => i.kind === 'agent')!.id;
  return [
    {
      actorId,
      event: {
        id: '00000000-0000-4000-8000-000000000096',
        at: new Date(Date.now() - 600000).toISOString(),
        command: 'workstream.update',
        entityId: state.workstreams[2].id,
        outcome: 'rejected',
        code: 'conflict',
        message: 'The record changed or another update conflicted. Reload before retrying.',
        transport: 'mcp',
        durationMs: 84,
        retryReference: 'd0d8e716fictionalretrykey1',
        validationFields: [],
      },
    },
    {
      actorId,
      event: {
        id: '00000000-0000-4000-8000-000000000097',
        at: new Date(Date.now() - 1200000).toISOString(),
        command: 'execution.report',
        entityId: null,
        outcome: 'error',
        code: 'storage_error',
        message: 'Storage could not confirm the operation. Reconcile or retry with the same key.',
        transport: 'rest',
        durationMs: 1500,
        retryReference: 'd0d8e716fictionalretrykey2',
        validationFields: [],
      },
    },
  ];
}
