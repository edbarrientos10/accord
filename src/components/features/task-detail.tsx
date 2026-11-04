'use client';
import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  Plus,
  Paperclip,
  ShieldCheck,
  MoreHorizontal,
  ArrowRight,
  CalendarDays,
} from 'lucide-react';
import type { Workstream } from '../../domain/types';
import { useTaskActions } from '../workspace/use-task-actions';
import { Avatar, Empty, Status } from '../workspace/ui';
import { localDate } from '../../domain/people-presentation';
import { str, reason, datetime, lines } from '../workspace/helpers';
import { TaskCommitments } from './people';
import { TaskReferences } from './task-references';
import { TaskLinks } from './task-links';
import { EditableText, TaskProperties } from './task-editing';
export function TaskDetail({ task: w, panel = false }: { task: Workstream; panel?: boolean }) {
  const a = useTaskActions(),
    { state, pending, patch, move, who } = a,
    params = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const tab = ['overview', 'decisions', 'evidence', 'activity'].includes(params.get('tab') ?? '')
      ? params.get('tab')!
      : 'overview',
    closed = ['completed', 'cancelled', 'dismissed'].includes(w.status),
    today = localDate(Date.now(), state.timezone);
  const actions = state.actions.filter((x) => x.workstreamId === w.id),
    evidence = state.evidence.filter((x) => x.workstreamId === w.id),
    executions = state.executions.filter((x) => x.workstreamId === w.id),
    grants = state.grants.filter((x) => x.workstreamId === w.id),
    decisions = state.decisions.filter((x) => x.workstreamId === w.id);
  const setTab = (value: string) => {
    const p = new URLSearchParams(params.toString());
    p.set('tab', value);
    router.replace(`${pathname}?${p}`, { scroll: false });
  };
  const changePolicy = () =>
    a.open(
      'Completion requirements',
      'workstream.update',
      [
        {
          name: 'completionPolicy',
          label: 'Completion',
          type: 'select',
          value: w.completionPolicy ?? 'verified',
          options: [
            { value: 'simple', label: 'Simple completion' },
            { value: 'verified', label: 'Verified completion' },
          ],
        },
        {
          name: 'criteria',
          label: 'Acceptance criteria',
          type: 'textarea',
          value: w.criteria.map((c) => c.text).join('\n'),
          when: { field: 'completionPolicy', value: 'verified' },
          hint: 'One criterion per line.',
        },
      ],
      (f) => ({
        entityId: w.id,
        expectedVersion: w.version,
        completionPolicy: str(f, 'completionPolicy'),
        criteria:
          str(f, 'completionPolicy') === 'verified'
            ? lines(f, 'criteria').map((text) => ({
                id: w.criteria.find((c) => c.text === text)?.id ?? crypto.randomUUID(),
                text,
              }))
            : w.criteria,
        reason: 'Changed completion requirements',
      }),
      'Changing requirements is recorded in task history.',
      'Save requirements',
    );
  return (
    <div className={`task-detail ${panel ? 'in-panel' : ''}`}>
      {!panel && (
        <Link className="back-link" href="/tasks">
          <ArrowLeft size={15} />
          All tasks
        </Link>
      )}
      <div className="task-heading">
        <div className="task-heading-top">
          <Status task={w} />
          {(w.priority === 'urgent' || w.priority === 'high') && (
            <span
              className={`signal-chip kind-${w.priority === 'urgent' ? 'incident' : 'blocker'}`}
            >
              {w.priority === 'urgent' ? 'Urgent' : 'High priority'}
            </span>
          )}
          {w.dueDate && !closed && (
            <span
              className={`signal-chip kind-${
                w.dueDate < today ? 'incident' : w.dueDate === today ? 'blocker' : 'followup'
              }`}
            >
              <CalendarDays size={12} aria-hidden />
              {w.dueDate < today
                ? 'Overdue'
                : w.dueDate === today
                  ? 'Due today'
                  : 'Due ' +
                    new Date(w.dueDate + 'T12:00:00Z').toLocaleDateString('en', {
                      timeZone: 'UTC',
                      month: 'short',
                      day: 'numeric',
                    })}
            </span>
          )}
          <span className="mono task-id">{w.id.slice(-6).toUpperCase()}</span>
        </div>
        <EditableText
          key={`title-${w.id}`}
          label="Task title"
          value={w.title}
          disabled={closed || pending}
          onSave={(value) => patch(w, { title: value })}
          heading
          headingLevel={panel ? 2 : 1}
        />
        <div className="task-heading-actions">
          <button className="button" disabled={pending || closed} onClick={() => a.complete(w)}>
            <Check size={16} />
            {w.completionPolicy === 'simple' ? 'Mark done' : 'Accept completion'}
          </button>
          <details className="more-menu">
            <summary aria-label="More task actions">
              <MoreHorizontal size={20} />
            </summary>
            <div className="menu-popover">
              {!closed ? (
                <>
                  <button onClick={() => a.editWork(w)}>Edit collaboration details</button>
                  <button onClick={() => changePolicy()}>Completion requirements</button>
                  <button onClick={() => a.standing(w)}>Grant permission</button>
                  <button
                    onClick={() =>
                      a.open(
                        'Cancel or dismiss task',
                        'workstream.terminate',
                        [
                          {
                            name: 'disposition',
                            label: 'Disposition',
                            type: 'select',
                            value: 'cancelled',
                            options: [
                              { value: 'cancelled', label: 'Cancelled' },
                              { value: 'dismissed', label: 'Dismissed' },
                            ],
                          },
                          { ...reason, value: '' },
                        ],
                        (f) => ({ ...a.base(w, f), disposition: str(f, 'disposition') }),
                        undefined,
                        'End task',
                      )
                    }
                  >
                    Cancel or dismiss
                  </button>
                </>
              ) : (
                <button onClick={() => move(w, 'todo')}>Reopen task</button>
              )}
            </div>
          </details>
        </div>
      </div>
      <div className="task-properties">
        <TaskProperties task={w} showProject />
        <div className="completion-property">
          <span>Completion</span>
          <button disabled={closed} onClick={changePolicy}>
            <ShieldCheck size={15} />
            {w.completionPolicy === 'simple' ? 'Simple' : 'Verified'}
          </button>
        </div>
      </div>
      <div className="detail-tabs" role="tablist" aria-label="Task sections">
        {['overview', 'decisions', 'evidence', 'activity'].map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
            {t === 'decisions' && actions.length > 0 && <span>{actions.length}</span>}
            {t === 'evidence' && evidence.length > 0 && <span>{evidence.length}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="detail-content">
        {tab === 'overview' && (
          <>
            <section className="section">
              <h2>Description</h2>
              <EditableText
                key={`outcome-${w.id}`}
                label="Task description"
                value={w.outcome}
                disabled={closed || pending}
                onSave={(value) => patch(w, { outcome: value })}
              />
            </section>
            <TaskLinks task={w} />
            <section className="next-step">
              <div className="section-title">
                <h2>
                  <ArrowRight size={15} aria-hidden />
                  Next step
                </h2>
                <span>
                  <Avatar name={who(w.nextAction?.ownerId ?? w.ownerId)} />
                  {who(w.nextAction?.ownerId ?? w.ownerId)}
                </span>
              </div>
              <EditableText
                key={`next-action-${w.id}`}
                label="Next step"
                value={w.nextAction?.text ?? ''}
                placeholder="What happens next?"
                disabled={closed || pending}
                onSave={(text) =>
                  patch(w, {
                    nextAction: text
                      ? { ...w.nextAction, text, ownerId: w.nextAction?.ownerId ?? w.ownerId }
                      : null,
                  })
                }
              />
              {w.nextAction?.dependency && (
                <p className="muted">Waiting on: {w.nextAction.dependency}</p>
              )}
            </section>
            {w.blocker ? (
              <section className="blocker-panel">
                <span className="eyebrow">BLOCKED · {who(w.blocker.resolverId)}</span>
                <h3>{w.blocker.cause}</h3>
                <p>Tried: {w.blocker.attemptedResolution}</p>
                <p>Resume when: {w.blocker.unblockCondition}</p>
                <button className="button secondary" onClick={() => a.unblock(w)}>
                  Resolve blocker
                </button>
              </section>
            ) : (
              !closed && (
                <button className="text-link" onClick={() => a.block(w)}>
                  Record blocker
                </button>
              )
            )}
            {w.completionPolicy !== 'simple' && (
              <section className="section">
                <div className="section-title">
                  <h2>Acceptance criteria</h2>
                  {!closed && (
                    <button className="text-link" onClick={changePolicy}>
                      Edit criteria
                    </button>
                  )}
                </div>
                <ul className="criteria-list">
                  {w.criteria.map((c) => (
                    <li key={c.id}>
                      <ShieldCheck size={17} />
                      <span>{c.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className="section">
              <h2>Latest update</h2>
              <p>{w.reportedProgress}</p>
              <p className="muted">Review reminder: {new Date(w.reviewAt).toLocaleString()}</p>
              {!closed && (
                <button
                  className="text-link"
                  onClick={() =>
                    a.open(
                      'Review reminder',
                      'workstream.update',
                      [
                        {
                          name: 'reviewAt',
                          label: 'Review at',
                          type: 'datetime-local',
                          value: datetime(w.reviewAt),
                        },
                      ],
                      (f) => ({
                        ...a.base(w, f),
                        reviewAt: new Date(str(f, 'reviewAt')).toISOString(),
                      }),
                      undefined,
                      'Set reminder',
                    )
                  }
                >
                  Change reminder
                </button>
              )}
            </section>
            <TaskCommitments taskId={w.id} />
            <TaskReferences selected={w} />
            {executions.length > 0 && (
              <section className="section">
                <h2>Executions</h2>
                {executions.map(a.executionCard)}
              </section>
            )}
          </>
        )}
        {tab === 'decisions' && (
          <>
            <div className="section-title">
              <h2>Proposals & decisions</h2>
              {!closed && (
                <button className="button secondary small" onClick={() => a.propose(w)}>
                  <Plus size={15} />
                  Propose action
                </button>
              )}
            </div>
            {actions.length ? (
              actions.map((action) => (
                <div key={action.id}>
                  {a.actionCard(action)}
                  {action.approvalRequested &&
                    !state.actions.some((x) => x.supersedesId === action.id) &&
                    !decisions.some((d) => d.subjectId === action.id) && (
                      <div className="button-row">
                        <button
                          className="button secondary small"
                          onClick={() => a.respond(action, 'changes_requested')}
                        >
                          Request changes
                        </button>
                        <button
                          className="text-link danger"
                          onClick={() => a.respond(action, 'declined')}
                        >
                          Decline
                        </button>
                      </div>
                    )}
                </div>
              ))
            ) : (
              <Empty
                title="No proposals yet"
                text="Actions that need approval will appear here with their exact scope and content."
              />
            )}
            {decisions.length > 0 && (
              <section className="section">
                <h2>Decision history</h2>
                {decisions.map((d) => (
                  <article className="compact-card" key={d.id}>
                    <span className="badge">{d.response.replaceAll('_', ' ')}</span>
                    <p>{d.feedback}</p>
                    <small>
                      {who(d.actorId)} · {new Date(d.createdAt).toLocaleString()}
                    </small>
                  </article>
                ))}
              </section>
            )}
            <section className="section">
              <div className="section-title">
                <h2>Permissions</h2>
                {!closed && (
                  <button className="text-link" onClick={() => a.standing(w)}>
                    Grant permission
                  </button>
                )}
              </div>
              {grants.length ? (
                grants.map(a.grantCard)
              ) : (
                <p className="muted">No permissions granted.</p>
              )}
            </section>
          </>
        )}
        {tab === 'evidence' && (
          <>
            <div className="section-title">
              <h2>Evidence</h2>
              <div className="button-row">
                <button className="button secondary small" onClick={() => a.attach(w, true)}>
                  <Paperclip size={15} />
                  Upload file
                </button>
                <button className="button secondary small" onClick={() => a.attach(w)}>
                  Attach reference
                </button>
              </div>
            </div>
            {evidence.length ? (
              evidence.map(a.evidenceCard)
            ) : (
              <Empty
                title="Evidence belongs with the work"
                text="Attach a file, source, or confirmation to support the result."
              />
            )}
          </>
        )}
        {tab === 'activity' &&
          a.activity([
            w.id,
            ...actions.map((x) => x.id),
            ...evidence.map((x) => x.id),
            ...grants.map((x) => x.id),
            ...executions.map((x) => x.id),
            ...decisions.map((x) => x.id),
          ])}
      </div>
    </div>
  );
}
