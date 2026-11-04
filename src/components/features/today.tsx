'use client';
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  Plus,
  Clock3,
  Check,
  ShieldCheck,
  AlertTriangle,
  ChevronRight,
  X,
  Users,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import {
  decisionQueue,
  filterTodayQueue,
  todayFilter,
  todayFilters,
  type QueueItem,
} from '../../domain/presentation';
import { localDate } from '../../domain/people-presentation';
import { useTaskActions } from '../workspace/use-task-actions';
import { Heading, Empty, Avatar, Status } from '../workspace/ui';
import { PeopleAttention, PeopleReminderActions } from './people';
import { EditableText, TaskProperties } from './task-editing';
import { str } from '../workspace/helpers';
const labels: Record<string, string> = {
  people: 'People',
  approval: 'Approval',
  review: 'Review result',
  blocker: 'Blocked',
  followup: 'Follow-up',
  incident: 'Needs attention',
};
const icons: Record<QueueItem['kind'], typeof Clock3> = {
  people: Users,
  approval: ShieldCheck,
  review: CheckCircle2,
  blocker: AlertTriangle,
  followup: Clock3,
  incident: AlertCircle,
};
// Groups follow the queue's rank order, so headers never reorder rows.
const groups: { label: string; kinds: QueueItem['kind'][] }[] = [
  { label: 'Needs attention', kinds: ['incident'] },
  { label: 'Waiting on your decision', kinds: ['approval', 'review'] },
  { label: 'Blocked', kinds: ['blocker'] },
  { label: 'Follow-ups', kinds: ['followup', 'people'] },
];
const groupOf = (item: QueueItem) => groups.find((g) => g.kinds.includes(item.kind))!;
// Generic reasons are shown as chips or replaced by the actual next step.
const generic = ['Your next step', 'Task due', 'Review reminder due'];
type Tone = QueueItem['kind'];
function signals(item: QueueItem, today: string) {
  const result: { label: string; tone: Tone }[] = [];
  if (item.dueDate && item.dueDate < today) result.push({ label: 'Overdue', tone: 'incident' });
  else if (item.dueDate === today) result.push({ label: 'Due today', tone: 'blocker' });
  if (item.priority >= 4) result.push({ label: 'Urgent', tone: 'incident' });
  else if (item.priority === 3) result.push({ label: 'High priority', tone: 'blocker' });
  if (item.reasons.includes('Review reminder due'))
    result.push({ label: 'Review due', tone: 'followup' });
  return result;
}
function KindChip({ kind, label = labels[kind] }: { kind: QueueItem['kind']; label?: string }) {
  const Icon = icons[kind];
  return (
    <span className={`kind-chip kind-${kind}`}>
      <Icon size={13} aria-hidden />
      {label}
    </span>
  );
}
function Signals({ item, today }: { item: QueueItem; today: string }) {
  return signals(item, today).map((s) => (
    <span key={s.label} className={`signal-chip kind-${s.tone}`}>
      {s.label}
    </span>
  ));
}
export function Today() {
  const a = useTaskActions(),
    { state } = a,
    params = useSearchParams(),
    router = useRouter(),
    [now, setNow] = useState(Date.now()),
    previousIndex = useRef(0),
    lastSelection = useRef<string | null>(null),
    drafts = useRef(new Set<string>()),
    discardDialog = useRef<HTMLDialogElement>(null),
    [navigation, setNavigation] = useState<(() => void) | null>(null),
    [editorVersion, setEditorVersion] = useState(0);
  const onDirtyChange = useCallback((key: string, dirty: boolean) => {
    if (dirty) drafts.current.add(key);
    else drafts.current.delete(key);
  }, []);
  const navigate = (action: () => void) => {
    if (a.pending) return;
    if (drafts.current.size) setNavigation(() => action);
    else action();
  };
  useEffect(() => {
    if (navigation) discardDialog.current?.showModal();
    else discardDialog.current?.close();
  }, [navigation]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const all = decisionQueue(state, now),
    filter = todayFilter(params.get('filter')),
    selectedId = params.get('item');
  const needsMe = filterTodayQueue(all, state, 'needs-me'),
    queue = filterTodayQueue(all, state, filter);
  const today = localDate(now, state.timezone),
    overdue = needsMe.filter((q) => q.dueDate && q.dueDate < today).length,
    dueToday = needsMe.filter((q) => q.dueDate === today).length,
    urgent = needsMe.filter((q) => q.priority >= 3).length,
    summary = [
      `${needsMe.length} ${needsMe.length === 1 ? 'item needs' : 'items need'} you`,
      overdue && `${overdue} overdue`,
      dueToday && `${dueToday} due today`,
      urgent && `${urgent} high priority`,
    ].filter(Boolean);
  const selected =
    queue.find((q) => q.id === (selectedId ?? lastSelection.current)) ??
    queue[Math.min(previousIndex.current, queue.length - 1)];
  useEffect(() => {
    if (selected) {
      lastSelection.current = selected.id;
      previousIndex.current = queue.findIndex((q) => q.id === selected.id);
    }
    if (selectedId && !queue.some((q) => q.id === selectedId)) {
      const p = new URLSearchParams(params.toString());
      if (selected) p.set('item', selected.id);
      else p.delete('item');
      router.replace(`/?${p}`, { scroll: false });
    }
  }, [state.revision, filter, now, selected?.id]);
  const choose = (item: QueueItem) =>
    navigate(() => {
      previousIndex.current = queue.findIndex((q) => q.id === item.id);
      const p = new URLSearchParams(params.toString());
      p.set('item', item.id);
      router.replace(`/?${p}`, { scroll: false });
    });
  const switchFilter = (value: string) =>
    navigate(() => {
      lastSelection.current = null;
      previousIndex.current = 0;
      router.replace(value === 'needs-me' ? '/' : `/?filter=${value}`, { scroll: false });
    });
  return (
    <>
      <dialog
        ref={discardDialog}
        className="command-dialog"
        aria-labelledby="discard-title"
        onCancel={(e) => {
          e.preventDefault();
          setNavigation(null);
        }}
      >
        <h2 id="discard-title">Discard unsaved changes?</h2>
        <p>Your text has not been saved.</p>
        <div className="button-row">
          <button className="button secondary" autoFocus onClick={() => setNavigation(null)}>
            Keep editing
          </button>
          <button
            className="button"
            onClick={() => {
              drafts.current.clear();
              setEditorVersion((v) => v + 1);
              setNavigation(null);
              navigation?.();
            }}
          >
            Discard changes
          </button>
        </div>
      </dialog>
      <Heading
        eyebrow={new Date(now)
          .toLocaleDateString('en', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            timeZone: state.timezone,
          })
          .toUpperCase()}
        title="Today"
        subtitle={summary.join(' · ')}
        action={
          <button className="button" onClick={() => a.createTask()}>
            <Plus size={17} />
            New task
          </button>
        }
      />
      <div className="queue-filters" aria-label="Queue filters">
        {todayFilters
          .map((f) => ({
            ...f,
            count: filterTodayQueue(all, state, f.value).length,
          }))
          .map((f) => (
            <button
              key={f.value}
              aria-pressed={filter === f.value}
              className={`${filter === f.value ? 'selected' : ''} ${f.count ? '' : 'empty-filter'}`}
              onClick={() => switchFilter(f.value)}
            >
              {f.value in labels && <i className={`filter-dot kind-${f.value}`} aria-hidden />}
              {f.label}
              <span>{f.count}</span>
            </button>
          ))}
      </div>
      {queue.length ? (
        <div className={`decision-workspace ${selectedId ? 'show-decision' : ''}`}>
          <div className="decision-queue" aria-label="Decision queue">
            {queue.map((item, i) => {
              const w = state.workstreams.find((w) => w.id === item.taskId),
                project = state.projects.find((p) => p.id === w?.projectId),
                group = groupOf(item),
                specific = item.reasons.find((r) => !generic.includes(r)),
                next = !specific && item.nextStep;
              return (
                <Fragment key={item.id}>
                  {(i === 0 || groupOf(queue[i - 1]) !== group) && (
                    <div className="queue-group">
                      {group.label}
                      <span>{queue.filter((q) => groupOf(q) === group).length}</span>
                    </div>
                  )}
                  <button
                    aria-pressed={selected?.id === item.id}
                    className={`queue-row kind-${item.kind} ${selected?.id === item.id ? 'selected' : ''}`}
                    onClick={() => choose(item)}
                  >
                    <div className="row-between">
                      <KindChip kind={item.kind} />
                      <span className="queue-signals">
                        <Signals item={item} today={today} />
                        <span className="queue-age">
                          {new Date(
                            item.at.length === 10 ? item.at + 'T12:00:00Z' : item.at,
                          ).toLocaleDateString('en', {
                            timeZone: item.at.length === 10 ? 'UTC' : state.timezone,
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </span>
                    </div>
                    <h3>{item.title}</h3>
                    {next ? (
                      <p className="queue-next">
                        <ArrowRight size={13} aria-hidden />
                        <span>{next}</span>
                      </p>
                    ) : (
                      <p>{specific ?? item.reasons[0]}</p>
                    )}
                    <div className="queue-row-bottom">
                      <span>
                        {project?.name ??
                          (item.operationId
                            ? 'Routine'
                            : item.kind === 'people'
                              ? 'People'
                              : 'No project')}
                      </span>
                      <span>
                        {/* Only call out owners other than you; your own items are the default. */}
                        {item.ownerId !== a.human?.id && (
                          <Avatar
                            name={a.who(item.ownerId)}
                            agent={
                              state.identities.find((i) => i.id === item.ownerId)?.kind === 'agent'
                            }
                          />
                        )}
                        <ChevronRight size={15} />
                      </span>
                    </div>
                  </button>
                </Fragment>
              );
            })}
            <div className="queue-footer">
              {queue.length} items · {todayFilters.find((f) => f.value === filter)?.label}
            </div>
          </div>
          {selected && (
            <section className="decision-pane" aria-label="Selected decision">
              <button
                className="text-link mobile-decision-back"
                onClick={() =>
                  navigate(() => {
                    const p = new URLSearchParams(params.toString());
                    p.delete('item');
                    router.replace(`/?${p}`, { scroll: false });
                  })
                }
              >
                <ArrowLeft size={16} />
                Back to queue
              </button>
              <DecisionContent
                key={selected.id}
                item={selected}
                navigate={navigate}
                onDirtyChange={onDirtyChange}
                editorVersion={editorVersion}
              />
            </section>
          )}
        </div>
      ) : (
        <Empty
          title={
            filter === 'snoozed'
              ? 'Nothing snoozed'
              : filter === 'needs-me'
                ? 'Nothing needs you right now'
                : 'You’re clear here'
          }
          text={
            filter === 'needs-me'
              ? 'Check Agent work or Monitoring to see delegated work and alerts.'
              : 'There are no items in this queue.'
          }
          action={
            <Link className="button secondary" href="/tasks">
              View tasks
              <ArrowRight size={16} />
            </Link>
          }
        />
      )}
    </>
  );
}
function DecisionContent({
  item,
  navigate,
  onDirtyChange,
  editorVersion,
}: {
  item: QueueItem;
  navigate: (action: () => void) => void;
  onDirtyChange: (key: string, dirty: boolean) => void;
  editorVersion: number;
}) {
  const [tab, setTab] = useState<'details' | 'updates'>('details');
  const router = useRouter();
  const a = useTaskActions(),
    { state } = a,
    w = state.workstreams.find((w) => w.id === item.taskId),
    proposal = state.actions.find((x) => x.id === item.subjectId),
    routine = state.operations.find((o) => o.id === item.operationId),
    project = state.projects.find((p) => p.id === w?.projectId),
    evidence = state.evidence.filter((e) =>
      w ? e.workstreamId === w.id : Boolean(routine && e.operationId === routine.id),
    ),
    Icon = icons[item.kind],
    today = localDate(Date.now(), state.timezone),
    why = item.reasons.filter((r) => !generic.includes(r));
  return (
    <>
      <div className="decision-scroll">
        <div className="decision-header">
          <div className="decision-breadcrumb">
            <span>{project?.name ?? (routine ? 'Recurring work' : w ? 'Task' : 'People')}</span>
            <span>/</span>
            <KindChip kind={item.kind} label={!w && !routine ? 'Reminder' : labels[item.kind]} />
          </div>
          <Link
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              navigate(() => {
                router.push(
                  w
                    ? `/tasks/${w.id}`
                    : routine
                      ? `/routines/${routine.id}`
                      : `/people/${item.peopleItems?.[0]?.personId}`,
                );
              });
            }}
            href={
              w
                ? `/tasks/${w.id}`
                : routine
                  ? `/routines/${routine.id}`
                  : `/people/${item.peopleItems?.[0]?.personId}`
            }
          >
            Full context
            <ArrowUpRight size={15} />
          </Link>
        </div>
        <div className="decision-title">
          <span className={`decision-icon kind-${item.kind}`}>
            <Icon size={22} aria-hidden />
          </span>
          {w ? (
            <EditableText
              key={`title-${w.id}-${editorVersion}`}
              label="Task title"
              value={w.title}
              heading
              headingLevel={2}
              disabled={a.pending}
              onDirtyChange={onDirtyChange}
              onSave={(title) => a.patch(w, { title })}
            />
          ) : (
            <h2>{item.title}</h2>
          )}
        </div>
        <div className="decision-owner">
          <Avatar name={a.who(item.ownerId)} />
          <span>{a.who(item.ownerId)}</span>
          {w && <Status task={w} />}
        </div>
        {!w && <p className="decision-description">{routine?.purpose}</p>}
        {item.snoozedUntil && item.reminderId && (
          <div className="notice">
            Snoozed until {new Date(item.snoozedUntil).toLocaleString()}
            <button
              className="text-link"
              onClick={() =>
                navigate(() => {
                  const r = state.reminders.find((r) => r.id === item.reminderId)!;
                  void a.run('reminder.clear', {
                    entityId: r.id,
                    expectedVersion: r.version,
                    reason: 'Restored reminder',
                  });
                })
              }
            >
              Bring back now
            </button>
          </div>
        )}
        {item.peopleItems?.length ? (
          <PeopleAttention items={item.peopleItems} actions={Boolean(w || routine)} />
        ) : null}
        {proposal ? (
          <>
            <h3 className="today-proposal-title">{item.title}</h3>
            <div className="content-preview">
              <div>
                <span className="eyebrow">EXACT CONTENT</span>
                <span className="mono">REV {String(proposal.revision).padStart(2, '0')}</span>
              </div>
              <pre>{proposal.content}</pre>
            </div>
            <div className="decision-facts">
              <div>
                <span>Action</span>
                <strong>{proposal.operation}</strong>
              </div>
              <div>
                <span>Target</span>
                <strong>{proposal.target}</strong>
              </div>
              <div>
                <span>Scope</span>
                <strong>{proposal.scope}</strong>
              </div>
              <div>
                <span>Declared cost</span>
                <strong>
                  {proposal.declaredCost} {proposal.currency}
                </strong>
              </div>
              <div>
                <span>Valid until</span>
                <strong>{new Date(proposal.expiresAt).toLocaleString()}</strong>
              </div>
            </div>
            <p className="decision-help">
              <ShieldCheck size={15} />
              Approval applies only to this revision and scope.
            </p>
          </>
        ) : w?.blocker || w?.status === 'ready_for_review' || routine ? (
          <>
            <section className="decision-callout">
              <span className="eyebrow">{w?.blocker ? 'WHAT’S IN THE WAY' : 'WHAT NEEDS YOU'}</span>
              <h3>{item.reasons[0]}</h3>
              {item.reasons.slice(1).map((r) => (
                <p key={r}>{r}</p>
              ))}
              {w?.blocker && (
                <>
                  <p>
                    <strong>Already tried:</strong> {w.blocker.attemptedResolution}
                  </p>
                  <p>
                    <strong>Resume when:</strong> {w.blocker.unblockCondition}
                  </p>
                </>
              )}
              {w?.nextAction && (
                <p>
                  <strong>Next step:</strong> {w.nextAction.text}
                </p>
              )}
            </section>
          </>
        ) : null}
        {w &&
          !proposal &&
          !w.blocker &&
          w.status !== 'ready_for_review' &&
          (why.length > 0 || signals(item, today).length > 0) && (
            <div className="decision-why">
              <Signals item={item} today={today} />
              {why.map((r) => (
                <span key={r}>{r}</span>
              ))}
            </div>
          )}
        {w && (
          <>
            <div
              className="detail-tabs today-tabs"
              role="tablist"
              aria-label="Selected task sections"
            >
              {(['details', 'updates'] as const).map((value) => (
                <button
                  key={value}
                  id={`today-tab-${value}`}
                  role="tab"
                  aria-selected={tab === value}
                  tabIndex={tab === value ? 0 : -1}
                  onKeyDown={(e) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
                    e.preventDefault();
                    const next =
                      e.key === 'Home'
                        ? 'details'
                        : e.key === 'End'
                          ? 'updates'
                          : tab === 'details'
                            ? 'updates'
                            : 'details';
                    if (next !== tab)
                      navigate(() => {
                        setTab(next);
                        document.getElementById(`today-tab-${next}`)?.focus();
                      });
                  }}
                  aria-controls="today-task-content"
                  onClick={() => {
                    if (value !== tab) navigate(() => setTab(value));
                  }}
                >
                  {value === 'details' ? 'Details' : 'Updates'}
                </button>
              ))}
            </div>
            <div
              role="tabpanel"
              id="today-task-content"
              aria-labelledby={`today-tab-${tab}`}
              tabIndex={0}
            >
              {tab === 'details' ? (
                <div key={`details-${editorVersion}`} className="today-task-details">
                  <section className="section next-step-callout">
                    <h3>
                      <ArrowRight size={15} aria-hidden />
                      Next step
                    </h3>
                    <EditableText
                      label="Next step"
                      value={w.nextAction?.text ?? ''}
                      disabled={a.pending}
                      onDirtyChange={onDirtyChange}
                      onSave={(text) =>
                        a.patch(w, {
                          nextAction: text
                            ? { ...w.nextAction, text, ownerId: w.nextAction?.ownerId ?? w.ownerId }
                            : null,
                        })
                      }
                    />
                  </section>
                  <div className="task-properties today-task-properties">
                    <TaskProperties task={w} requestChange={navigate} />
                  </div>
                  <section className="section">
                    <h3>Description</h3>
                    <EditableText
                      label="Task description"
                      value={w.outcome}
                      disabled={a.pending}
                      onDirtyChange={onDirtyChange}
                      onSave={(outcome) => a.patch(w, { outcome })}
                    />
                  </section>
                  {w && w.criteria.length > 0 && (
                    <section className="decision-criteria">
                      <span className="eyebrow">ACCEPTANCE CRITERIA</span>
                      {w.criteria.map((c) => (
                        <p key={c.id}>
                          <Check size={16} />
                          {c.text}
                        </p>
                      ))}
                    </section>
                  )}
                </div>
              ) : (
                <div key={`updates-${editorVersion}`} className="today-task-updates">
                  <section className="section">
                    <h3>Latest update</h3>
                    <EditableText
                      label="Latest update"
                      value={w.reportedProgress}
                      disabled={a.pending}
                      onDirtyChange={onDirtyChange}
                      onSave={(reportedProgress) => a.patch(w, { reportedProgress })}
                    />
                  </section>
                  <section className="section">
                    <h3>Supporting evidence</h3>
                    <div className="button-row">
                      <button
                        className="button secondary small"
                        disabled={a.pending}
                        onClick={() => navigate(() => a.attach(w, true))}
                      >
                        Upload file
                      </button>
                      <button
                        className="button secondary small"
                        disabled={a.pending}
                        onClick={() => navigate(() => a.attach(w))}
                      >
                        Attach reference
                      </button>
                    </div>
                    {evidence.length ? (
                      evidence.map(a.evidenceCard)
                    ) : (
                      <p className="muted">No supporting evidence yet.</p>
                    )}
                  </section>
                </div>
              )}
            </div>
          </>
        )}
        {!w && evidence.length > 0 && (
          <section className="section">
            <h3>Supporting evidence</h3>
            {evidence.map(a.evidenceCard)}
          </section>
        )}
      </div>
      <fieldset className="decision-actions" disabled={a.pending}>
        <legend className="sr-only">Decision actions</legend>
        {!w && !routine && item.peopleItems?.[0] ? (
          <PeopleReminderActions item={item.peopleItems[0]} />
        ) : proposal ? (
          <>
            <button
              className="button"
              disabled={a.pending || Date.parse(proposal.expiresAt) <= Date.now()}
              onClick={() =>
                navigate(() =>
                  a.open(
                    'Approve this action revision',
                    'grant.approve',
                    [
                      {
                        name: 'granteeId',
                        label: 'Who may execute this action?',
                        type: 'select',
                        value: w?.assignedAgentIds[0] ?? a.human?.id,
                        options: a.people(['human', 'agent']),
                      },
                    ],
                    (f) => ({ ...a.base(proposal, f), granteeId: str(f, 'granteeId') }),
                    `${proposal.effect}\nTarget: ${proposal.target}\nContent:\n${proposal.content}\nScope: ${proposal.scope}\nDeclared cost: ${proposal.declaredCost} ${proposal.currency}`,
                    'Approve revision',
                  ),
                )
              }
            >
              <Check size={16} />
              Review & approve
            </button>
            <button
              className="button secondary"
              onClick={() => navigate(() => a.respond(proposal, 'changes_requested'))}
            >
              Request changes
            </button>
            <button
              className="text-link danger"
              onClick={() => navigate(() => a.respond(proposal, 'declined'))}
            >
              Decline
            </button>
          </>
        ) : w?.status === 'ready_for_review' ? (
          <>
            <button className="button" onClick={() => navigate(() => a.complete(w))}>
              <Check size={16} />
              Accept completion
            </button>
            <button
              className="button secondary"
              onClick={() => navigate(() => a.respond(w, 'changes_requested'))}
            >
              Request changes
            </button>
          </>
        ) : w?.blocker ? (
          <button className="button" onClick={() => navigate(() => a.unblock(w))}>
            Resolve blocker
            <ArrowRight size={16} />
          </button>
        ) : w ? (
          <button className="button" onClick={() => navigate(() => a.complete(w))}>
            <Check size={16} />
            {w.completionPolicy === 'simple' ? 'Mark done' : 'Accept completion'}
          </button>
        ) : (
          <Link
            className="button"
            href={
              routine ? `/routines/${routine.id}` : `/people/${item.peopleItems?.[0]?.personId}`
            }
          >
            {item.kind === 'incident'
              ? 'Review execution'
              : 'Open ' + (w ? 'task' : routine ? 'routine' : 'person')}
            <ArrowRight size={16} />
          </Link>
        )}
        {w && !proposal && (
          <button
            className="button quiet"
            disabled={a.pending}
            onClick={() => navigate(() => a.move(w, 'dismissed'))}
          >
            <X size={16} />
            Dismiss
          </button>
        )}
        {!item.snoozedUntil && item.kind !== 'people' && (
          <button
            className="button quiet"
            onClick={() => navigate(() => a.snooze({ id: item.subjectId, version: item.version }))}
          >
            <Clock3 size={16} />
            Snooze
          </button>
        )}
      </fieldset>
    </>
  );
}
