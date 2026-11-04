'use client';
import type { Workstream, Project } from '../../domain/types';
import type { Field } from '../forms';
import { useWorkspace } from './context';
import { useActions } from './use-actions';
import { str, lines, reason, datetime, iso } from './helpers';
export function useTaskActions() {
  const ctx = useWorkspace(),
    a = useActions();
  const { state, run } = ctx;
  const priorities: Field = {
    name: 'priority',
    label: 'Priority',
    type: 'select',
    value: 'none',
    options: ['none', 'low', 'medium', 'high', 'urgent'].map((value) => ({
      value,
      label: value[0].toUpperCase() + value.slice(1),
    })),
  };
  const createTask = (projectId?: string) =>
    a.open(
      'New task',
      'workstream.create',
      [
        { name: 'title', label: 'Task title' },
        { name: 'description', label: 'Description', type: 'textarea', required: false },
        { ...a.ownerField(), value: a.human?.id },
        {
          name: 'projectId',
          label: 'Project',
          type: 'select',
          required: false,
          value: projectId,
          options: state.projects
            .filter((p) => p.status === 'active')
            .map((p) => ({ value: p.id, label: p.name })),
        },
        priorities,
        { name: 'dueDate', label: 'Due date', type: 'date', required: false },
        {
          name: 'completionPolicy',
          label: 'Completion',
          type: 'select',
          value: 'simple',
          options: [
            { value: 'simple', label: 'Simple — mark done when finished' },
            { value: 'verified', label: 'Verified — criteria and acceptance' },
          ],
        },
        {
          name: 'criteria',
          label: 'Acceptance criteria',
          type: 'textarea',
          when: { field: 'completionPolicy', value: 'verified' },
          hint: 'One criterion per line.',
        },
      ],
      (f) => {
        const ownerId = str(f, 'ownerId');
        return {
          title: str(f, 'title'),
          outcome: str(f, 'description') || str(f, 'title'),
          ownerId,
          assignedAgentIds: state.identities.some((i) => i.id === ownerId && i.kind === 'agent')
            ? [ownerId]
            : [],
          projectId: str(f, 'projectId') || null,
          priority: str(f, 'priority'),
          dueDate: str(f, 'dueDate') || null,
          completionPolicy: str(f, 'completionPolicy'),
          criteria:
            str(f, 'completionPolicy') === 'verified'
              ? lines(f, 'criteria').map((text) => ({ id: crypto.randomUUID(), text }))
              : [],
          nextAction: null,
          reason: 'Created task',
        };
      },
      undefined,
      'Create task',
    );
  const projectForm = (p?: Project) =>
    a.open(
      p ? 'Edit project' : 'New project',
      p ? 'project.update' : 'project.create',
      [
        { name: 'name', label: 'Project name', value: p?.name },
        {
          name: 'description',
          label: 'Description',
          type: 'textarea',
          value: p?.description,
          required: false,
        },
        {
          name: 'targetDate',
          label: 'Target date',
          type: 'date',
          value: p?.targetDate ?? '',
          required: false,
        },
        ...(p
          ? [
              {
                name: 'status',
                label: 'Project status',
                type: 'select',
                value: p.status,
                options: [
                  { value: 'active', label: 'Active' },
                  { value: 'archived', label: 'Archived' },
                ],
              } satisfies Field,
            ]
          : []),
      ],
      (f) => ({
        ...(p ? { entityId: p.id, expectedVersion: p.version, status: str(f, 'status') } : {}),
        name: str(f, 'name'),
        description: str(f, 'description'),
        targetDate: str(f, 'targetDate') || null,
        reason: p ? 'Updated project' : 'Created project',
      }),
      undefined,
      p ? 'Save project' : 'Create project',
    );
  const patch = (w: Workstream, values: Partial<Workstream>) =>
    run('workstream.update', {
      entityId: w.id,
      expectedVersion: w.version,
      ...values,
      reason: 'Updated task',
    });
  const complete = (w: Workstream) => {
    if (w.completionPolicy === 'simple')
      void run('workstream.close', {
        entityId: w.id,
        expectedVersion: w.version,
        evidenceIds: [],
        reason: 'Marked task done',
      });
    else a.close(w);
  };
  const block = (w: Workstream) =>
    a.open(
      'Record blocker',
      'workstream.block',
      [
        { name: 'cause', label: 'Why progress stopped', type: 'textarea' },
        { name: 'attemptedResolution', label: 'What was tried', type: 'textarea' },
        {
          name: 'unblockCondition',
          label: 'Specific condition needed to continue',
          type: 'textarea',
        },
        {
          name: 'resolverId',
          label: 'Who can resolve it?',
          type: 'select',
          value: a.human?.id,
          options: a.people(),
        },
      ],
      (f) => ({
        ...a.base(w, f),
        cause: str(f, 'cause'),
        attemptedResolution: str(f, 'attemptedResolution'),
        unblockCondition: str(f, 'unblockCondition'),
        resolverId: str(f, 'resolverId'),
      }),
      undefined,
      'Record blocker',
    );
  const unblock = (w: Workstream) =>
    a.open(
      'Resolve blocker',
      'workstream.unblock',
      [{ ...reason, value: '', label: 'What resolved it?' }],
      (f) => a.base(w, f),
      w.blocker?.unblockCondition,
      'Resolve blocker',
    );
  const respond = (
    entity: { id: string; version: number },
    response: 'declined' | 'changes_requested',
  ) =>
    a.open(
      response === 'declined' ? 'Decline proposal' : 'Request changes',
      'decision.respond',
      [{ name: 'feedback', label: 'Feedback for the agent', type: 'textarea' }],
      (f) => ({
        entityId: entity.id,
        expectedVersion: entity.version,
        response,
        feedback: str(f, 'feedback'),
        reason: str(f, 'feedback'),
      }),
      undefined,
      response === 'declined' ? 'Decline proposal' : 'Request changes',
    );
  const move = (w: Workstream, stage: string) => {
    if ((w.status === 'open' ? (w.planningStage ?? 'todo') : w.status) === stage) return;
    if (stage === 'cancelled' || stage === 'dismissed') {
      a.open(
        stage === 'cancelled' ? 'Cancel task' : 'Dismiss task',
        'workstream.terminate',
        [{ ...reason, value: '' }],
        (f) => ({ ...a.base(w, f), disposition: stage }),
        undefined,
        stage === 'cancelled' ? 'Cancel task' : 'Dismiss task',
      );
      return;
    }
    if (stage === 'completed') {
      complete(w);
      return;
    }
    if (['completed', 'cancelled', 'dismissed'].includes(w.status)) {
      a.open(
        'Reopen task',
        'workstream.reopen',
        [{ ...reason, value: '', label: 'Reason for reopening' }],
        (f) => a.base(w, f),
        undefined,
        'Reopen task',
      );
      return;
    }
    if (stage === 'blocked') {
      block(w);
      return;
    }
    if (w.blocker) {
      unblock(w);
      return;
    }
    if (stage === 'ready_for_review') {
      void run('workstream.review', {
        entityId: w.id,
        expectedVersion: w.version,
        reason: 'Submitted result for review',
      });
      return;
    }
    if (w.status === 'ready_for_review') {
      respond(w, 'changes_requested');
      return;
    }
    void patch(w, { planningStage: stage as 'todo' | 'in_progress' });
  };
  const snooze = (entity: { id: string; version: number }) =>
    a.open(
      'Snooze reminder',
      'reminder.snooze',
      [
        {
          name: 'until',
          label: 'Remind me at',
          type: 'datetime-local',
          value: datetime(new Date(Date.now() + 86400000).toISOString()),
        },
      ],
      (f) => ({
        entityId: entity.id,
        expectedVersion: entity.version,
        until: iso(f, 'until'),
        reason: 'Snoozed reminder',
      }),
      'Only this reminder is postponed. Task dates and permissions stay as recorded.',
      'Snooze',
    );
  return {
    ...a,
    ...ctx,
    createTask,
    projectForm,
    patch,
    complete,
    block,
    unblock,
    respond,
    move,
    snooze,
  };
}
