'use client';
import type {
  Person,
  Commitment,
  ImportantDate,
  Interaction,
  RelationshipGroup,
} from '../../domain/types';
import { commitmentStates } from '../../domain/people-schema';
import type { Field } from '../forms';
import { useWorkspace } from './context';
import { useActions } from './use-actions';
import { str, datetime, iso } from './helpers';
import type { PeopleQueueItem } from '../../domain/people-presentation';
const options = (items: string[]) =>
  items.map((value) => ({ value, label: value.replaceAll('_', ' ') }));
const textList = (value: string) =>
  value
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => {
      const parts = v.split('|');
      return {
        label: parts.length > 1 ? parts.shift()!.trim() : 'Other',
        value: parts.join('|').trim(),
      };
    });
const serialize = (items: { label: string; value: string }[]) =>
  items.map((i) => `${i.label} | ${i.value}`).join('\n');
export function usePeopleActions() {
  const c = useWorkspace(),
    a = useActions(),
    s = c.state;
  const personOptions = s.people.map((p) => ({ value: p.id, label: p.name }));
  const select = (
    name: string,
    label: string,
    values: { value: string; label: string }[],
    value?: string,
    required = true,
  ): Field => ({ name, label, type: 'select', options: values, value, required });
  const editPerson = (p?: Person) =>
    a.open(
      p ? 'Edit contact' : 'New person',
      p ? 'person.update' : 'person.create',
      [
        { name: 'name', label: 'Name', value: p?.name },
        { name: 'organization', label: 'Organization', value: p?.organization, required: false },
        { name: 'role', label: 'Role', value: p?.role, required: false },
        select(
          'groupId',
          'Relationship group',
          s.relationshipGroups.map((g) => ({ value: g.id, label: g.name })),
          p?.groupId ?? s.relationshipGroups.find((g) => g.name === 'Other')?.id,
        ),
        {
          name: 'tags',
          label: 'Tags',
          value: p?.tags.join(', '),
          required: false,
          hint: 'Separate tags with commas.',
        },
        ...(['emails', 'phones', 'links'] as const).map((name) => ({
          name,
          label: { emails: 'Email addresses', phones: 'Phone numbers', links: 'Links' }[name],
          type: 'textarea' as const,
          value: p ? serialize(p[name]) : '',
          required: false,
          hint: 'One per line: label | value',
        })),
        {
          name: 'notes',
          label: 'Relationship notes',
          type: 'textarea',
          value: p?.notes,
          required: false,
        },
        select(
          'cadenceMode',
          'Stay in touch',
          options(['inherit', 'custom', 'paused']),
          p?.cadenceMode ?? 'inherit',
        ),
        {
          name: 'cadenceDays',
          label: 'Contact every (days)',
          type: 'number',
          value: String(p?.cadenceDays ?? 30),
          when: { field: 'cadenceMode', value: 'custom' },
        },
      ],
      (f) => ({
        ...(p ? a.base(p, f) : { reason: 'Created contact' }),
        name: str(f, 'name'),
        organization: str(f, 'organization'),
        role: str(f, 'role'),
        groupId: str(f, 'groupId'),
        tags: str(f, 'tags')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        notes: str(f, 'notes'),
        emails: textList(str(f, 'emails')),
        phones: textList(str(f, 'phones')),
        links: textList(str(f, 'links')),
        cadenceMode: str(f, 'cadenceMode'),
        cadenceDays: str(f, 'cadenceMode') === 'custom' ? Number(f.get('cadenceDays')) : null,
      }),
      undefined,
      p ? 'Save contact' : 'Create person',
    );
  const interaction = (personId: string, i?: Interaction) =>
    a.open(
      i ? 'Correct interaction' : 'Log interaction',
      i ? 'interaction.correct' : 'interaction.log',
      [
        {
          name: 'occurredAt',
          label: 'When',
          type: 'datetime-local',
          value: datetime(i?.occurredAt ?? new Date().toISOString()),
        },
        select(
          'channel',
          'Channel',
          options(['meeting', 'call', 'message', 'email', 'other']),
          i?.channel ?? 'message',
        ),
        { name: 'summary', label: 'What happened', type: 'textarea', value: i?.summary },
        select(
          'meaningful',
          'Counts as meaningful contact',
          [
            { value: 'true', label: 'Yes · reset stay-in-touch timing' },
            { value: 'false', label: 'No · keep existing timing' },
          ],
          String(i?.meaningful ?? true),
        ),
        { name: 'source', label: 'Source reference', value: i?.source, required: false },
        ...(i
          ? [
              select(
                'voided',
                'Record status',
                [
                  { value: 'false', label: 'Valid interaction' },
                  { value: 'true', label: 'Void incorrect entry' },
                ],
                String(i.voided),
              ),
            ]
          : []),
      ],
      (f) => ({
        ...(i ? a.base(i, f) : { reason: 'Logged interaction' }),
        personId,
        occurredAt: iso(f, 'occurredAt'),
        channel: str(f, 'channel'),
        summary: str(f, 'summary'),
        meaningful: str(f, 'meaningful') === 'true',
        source: str(f, 'source'),
        voided: str(f, 'voided') === 'true',
      }),
      undefined,
      i ? 'Save correction' : 'Log interaction',
    );
  const importantDate = (personId: string, d?: ImportantDate) =>
    a.open(
      d ? 'Edit important date' : 'Add important date',
      d ? 'important_date.update' : 'important_date.create',
      [
        { name: 'title', label: 'Occasion', value: d?.title ?? 'Birthday' },
        select(
          'kind',
          'Type',
          options(['birthday', 'anniversary', 'other']),
          d?.kind ?? 'birthday',
        ),
        {
          name: 'month',
          label: 'Month (1–12)',
          type: 'number',
          value: d ? String(d.month) : undefined,
        },
        { name: 'day', label: 'Day', type: 'number', value: d ? String(d.day) : undefined },
        {
          name: 'year',
          label: 'Year (optional for annual dates)',
          type: 'number',
          value: d?.year ? String(d.year) : '',
          required: false,
        },
        select(
          'annual',
          'Repeats',
          [
            { value: 'true', label: 'Every year' },
            { value: 'false', label: 'One time' },
          ],
          String(d?.annual ?? true),
        ),
        select(
          'advance',
          'Seven-day advance reminder',
          [
            { value: 'false', label: 'Off · remind me on the day' },
            { value: 'true', label: 'On · also remind me seven days before' },
          ],
          String(d?.advance ?? false),
        ),
        ...(d
          ? [
              select(
                'active',
                'Reminder status',
                [
                  { value: 'true', label: 'Active' },
                  { value: 'false', label: 'Disabled' },
                ],
                String(d.active),
              ),
            ]
          : []),
      ],
      (f) => ({
        ...(d ? a.base(d, f) : { reason: 'Added important date' }),
        personId,
        title: str(f, 'title'),
        kind: str(f, 'kind'),
        month: Number(f.get('month')),
        day: Number(f.get('day')),
        year: str(f, 'year') ? Number(f.get('year')) : null,
        annual: str(f, 'annual') === 'true',
        advance: str(f, 'advance') === 'true',
        active: d ? str(f, 'active') === 'true' : true,
      }),
      'Birthdays remind you on the day every year. The year can stay unknown.',
      d ? 'Save date' : 'Add date',
    );
  const commitment = (personId?: string, v?: Commitment, taskId?: string) =>
    a.open(
      v ? 'Edit commitment' : 'New commitment',
      v ? 'commitment.update' : 'commitment.create',
      [
        select('personId', 'Person', personOptions, v?.personId ?? personId),
        select(
          'direction',
          'Direction',
          [
            { value: 'waiting_on', label: 'Waiting on them' },
            { value: 'i_owe', label: 'I owe them' },
          ],
          v?.direction ?? 'waiting_on',
        ),
        { name: 'title', label: 'Requested outcome', type: 'textarea', value: v?.title },
        select(
          'coordinatorId',
          'Accountable coordinator',
          a.people(['human', 'agent']),
          v?.coordinatorId ?? a.human?.id,
        ),
        {
          name: 'promisedDate',
          label: 'Promised date',
          type: 'date',
          value: v?.promisedDate ?? '',
          required: false,
        },
        {
          name: 'followUpAt',
          label: 'Next follow-up',
          type: 'datetime-local',
          value: v?.followUpAt ? datetime(v.followUpAt) : '',
          required: false,
        },
        select(
          'priority',
          'Priority',
          options(['none', 'low', 'medium', 'high', 'urgent']),
          v?.priority ?? 'none',
        ),
        select(
          'workstreamId',
          'Linked task',
          s.workstreams.map((w) => ({ value: w.id, label: w.title })),
          v?.workstreamId ?? taskId,
          false,
        ),
        select(
          'projectId',
          'Linked project',
          s.projects.map((p) => ({ value: p.id, label: p.name })),
          v?.projectId ?? undefined,
          false,
        ),
        select(
          'required',
          'Required for task completion',
          [
            { value: 'false', label: 'No · informational link' },
            { value: 'true', label: 'Yes · fulfill or waive before completion' },
          ],
          String(v?.required ?? false),
        ),
        { name: 'source', label: 'Source reference', value: v?.source, required: false },
      ],
      (f) => ({
        ...(v ? a.base(v, f) : { reason: 'Recorded commitment request' }),
        personId: str(f, 'personId'),
        direction: str(f, 'direction'),
        title: str(f, 'title'),
        coordinatorId: str(f, 'coordinatorId'),
        promisedDate: str(f, 'promisedDate') || null,
        followUpAt: str(f, 'followUpAt') ? iso(f, 'followUpAt') : null,
        priority: str(f, 'priority'),
        workstreamId: str(f, 'workstreamId') || null,
        projectId: str(f, 'projectId') || null,
        required: str(f, 'required') === 'true',
        source: str(f, 'source'),
      }),
      'Recording a request does not mean the person agreed. Update its state when their commitment is confirmed.',
      v ? 'Save commitment' : 'Record request',
    );
  const transition = (v: Commitment) =>
    a.open(
      'Update commitment state',
      'commitment.transition',
      [
        select(
          'status',
          'New state',
          options(commitmentStates.filter((x) => x !== v.status)),
          v.status === 'requested'
            ? 'committed'
            : v.status === 'committed'
              ? 'reported_done'
              : v.status === 'reported_done'
                ? 'fulfilled'
                : 'requested',
        ),
        { name: 'note', label: 'What establishes this change?', type: 'textarea' },
      ],
      (f) => ({
        ...a.base(v, f),
        status: str(f, 'status'),
        note: str(f, 'note'),
        reason: str(f, 'note'),
      }),
      'Fulfillment records an attributable confirmation. It does not complete linked tasks or verify their evidence.',
      'Record state change',
    );
  const group = (g?: RelationshipGroup) =>
    a.open(
      g ? 'Edit relationship group' : 'New relationship group',
      g ? 'relationship_group.update' : 'relationship_group.create',
      [
        { name: 'name', label: 'Group name', value: g?.name },
        {
          name: 'cadenceDays',
          label: 'Stay in touch every (days)',
          type: 'number',
          value: g?.cadenceDays ? String(g.cadenceDays) : '',
          required: false,
          hint: 'Leave empty to turn reminders off.',
        },
      ],
      (f) => ({
        ...(g ? a.base(g, f) : { reason: 'Created relationship group' }),
        name: str(f, 'name'),
        cadenceDays: str(f, 'cadenceDays') ? Number(f.get('cadenceDays')) : null,
      }),
      undefined,
      'Save group',
    );
  const dismiss = (q: PeopleQueueItem) => {
    const commitment = s.commitments.find((c) => c.id === q.commitmentId);
    const description = commitment
      ? commitment.required
        ? 'This waives the required commitment and stops its reminders. It will no longer be required to complete the linked task.'
        : 'This closes the commitment as cancelled and stops its reminders. It remains in the person’s history.'
      : q.category === 'contact'
        ? 'This pauses stay-in-touch reminders for this person. You can enable them again in their profile.'
        : 'This turns off this important date, including future reminders. You can enable it again in the person’s profile.';
    a.open(
      'Dismiss ' + (commitment ? 'commitment' : 'reminder'),
      commitment
        ? 'commitment.transition'
        : q.category === 'contact'
          ? 'person.update'
          : 'important_date.update',
      [{ name: 'reason', label: 'Reason', value: 'No longer needed', type: 'textarea' }],
      (f) => ({
        entityId: q.subjectId,
        expectedVersion: q.version,
        reason: str(f, 'reason'),
        ...(commitment
          ? { status: commitment.required ? 'waived' : 'cancelled', note: str(f, 'reason') }
          : q.category === 'contact'
            ? { cadenceMode: 'paused' }
            : { active: false }),
      }),
      description,
      'Dismiss',
    );
  };
  const snooze = (q: PeopleQueueItem) =>
    a.open(
      'Snooze relationship reminder',
      'people_reminder.respond',
      [
        {
          name: 'until',
          label: 'Remind me after',
          type: 'datetime-local',
          value: datetime(new Date(Date.now() + 86400000).toISOString()),
        },
      ],
      (f) => ({
        entityId: q.subjectId,
        expectedVersion: q.version,
        occurrenceKey: q.occurrenceKey,
        response: 'snoozed',
        until: iso(f, 'until'),
        reason: 'Postponed relationship reminder',
      }),
      undefined,
      'Snooze reminder',
    );
  return {
    ...a,
    ...c,
    editPerson,
    interaction,
    importantDate,
    commitment,
    transition,
    group,
    snooze,
    dismiss,
  };
}
