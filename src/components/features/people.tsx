'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Plus, ArrowUpRight, X, Users, CalendarDays, ArrowLeft } from 'lucide-react';
import type { Person, Commitment } from '../../domain/types';
import {
  nextContactDate,
  upcomingDates,
  type PeopleQueueItem,
} from '../../domain/people-presentation';
import { usePeopleActions } from '../workspace/use-people-actions';
import { Heading, Empty, Avatar } from '../workspace/ui';
import { PeopleImport } from './people-import';
export function People() {
  const a = usePeopleActions(),
    s = a.state,
    params = useSearchParams(),
    router = useRouter();
  const [importing, setImporting] = useState(false),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const view = params.get('view') ?? 'directory',
    query = params.get('q') ?? '',
    group = params.get('group') ?? '',
    status = params.get('status') ?? 'active',
    direction = params.get('direction') ?? '';
  const update = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    router.replace('/people?' + p, { scroll: false });
  };
  const selected = s.people.find((p) => p.id === params.get('person'));
  const matches = (p: Person) =>
    `${p.name} ${p.organization} ${p.role} ${p.tags.join(' ')}`
      .toLowerCase()
      .includes(query.toLowerCase()) &&
    (!group || p.groupId === group);
  const people = s.people
    .filter((p) => matches(p) && (status === 'all' || p.status === status))
    .sort((a, b) => a.name.localeCompare(b.name));
  const commitments = s.commitments.filter((c) => {
    const p = s.people.find((p) => p.id === c.personId);
    return (
      p &&
      (!group || p.groupId === group) &&
      (!query || `${p.name} ${c.title}`.toLowerCase().includes(query.toLowerCase())) &&
      (!direction || c.direction === direction) &&
      (params.get('resolved') === 'true' ||
        !['fulfilled', 'declined', 'cancelled', 'waived'].includes(c.status))
    );
  });
  return (
    <>
      <Heading
        eyebrow="RELATIONSHIPS & FOLLOW-THROUGH"
        title="People"
        subtitle="Remember what matters. Keep your promises in view."
        action={
          <div className="button-row">
            <button className="button secondary" onClick={() => setImporting(true)}>
              Import contacts
            </button>
            <button className="button" onClick={() => a.editPerson()}>
              <Plus size={16} />
              New person
            </button>
          </div>
        }
      />
      <div className="people-tabs" role="navigation" aria-label="People views">
        {['directory', 'commitments', 'upcoming'].map((v) => (
          <button
            key={v}
            aria-current={view === v ? 'page' : undefined}
            className={view === v ? 'selected' : ''}
            onClick={() => update('view', v)}
          >
            {v === 'directory' ? (
              <Users size={16} />
            ) : v === 'upcoming' ? (
              <CalendarDays size={16} />
            ) : null}
            {v[0].toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>
      <h2 className="sr-only">
        {view === 'commitments'
          ? 'Commitment ledger'
          : view === 'upcoming'
            ? 'Upcoming dates'
            : 'Contact directory'}
      </h2>
      <div className="people-filters">
        <input
          aria-label="Search people"
          placeholder="Find a person, organization or tag…"
          value={query}
          onChange={(e) => update('q', e.target.value)}
        />
        <select
          aria-label="Filter by relationship group"
          value={group}
          onChange={(e) => update('group', e.target.value)}
        >
          <option value="">All groups</option>
          {s.relationshipGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        {view === 'directory' && (
          <select
            aria-label="Contact status"
            value={status}
            onChange={(e) => update('status', e.target.value)}
          >
            <option value="active">Active contacts</option>
            <option value="archived">Archived contacts</option>
            <option value="all">All contacts</option>
          </select>
        )}
        {view === 'commitments' && (
          <>
            <select
              aria-label="Commitment direction"
              value={direction}
              onChange={(e) => update('direction', e.target.value)}
            >
              <option value="">Both directions</option>
              <option value="waiting_on">Waiting on them</option>
              <option value="i_owe">I owe them</option>
            </select>
            <label className="check-option">
              <input
                type="checkbox"
                checked={params.get('resolved') === 'true'}
                onChange={(e) => update('resolved', String(e.target.checked))}
              />
              Include resolved
            </label>
            <button className="button secondary" onClick={() => a.commitment()}>
              New commitment
            </button>
          </>
        )}
      </div>
      {view === 'directory' && (
        <div className="people-layout">
          <section className="people-directory" aria-label="Contact directory">
            {people.length ? (
              people.map((p) => (
                <button className="person-row" key={p.id} onClick={() => update('person', p.id)}>
                  <Avatar name={p.name} />
                  <span className="person-name">
                    <strong>{p.name}</strong>
                    <small>
                      {[p.role, p.organization].filter(Boolean).join(' · ') || 'Personal contact'}
                    </small>
                  </span>
                  <span className="person-group">
                    {s.relationshipGroups.find((g) => g.id === p.groupId)?.name}
                  </span>
                  <span className="person-next">
                    <small>Next contact</small>
                    {nextContactDate(s, p.id) ?? 'Not scheduled'}
                  </span>
                  <ArrowUpRight size={17} />
                </button>
              ))
            ) : (
              <Empty
                title="No people here yet"
                text="Add a person or import your contacts to start keeping track."
              />
            )}
          </section>
          <aside className="people-aside" aria-label="Relationship groups">
            <span className="eyebrow">STAY IN TOUCH</span>
            <h2>A rhythm for each circle</h2>
            <p className="muted">
              Meaningful contact resets the clock. Individual profiles can override or pause their
              group.
            </p>
            {s.relationshipGroups.map((g) => (
              <button className="group-row" key={g.id} onClick={() => a.group(g)}>
                <strong>{g.name}</strong>
                <span>{g.cadenceDays ? `${g.cadenceDays} days` : 'Off'}</span>
              </button>
            ))}
            <button className="text-link" onClick={() => a.group()}>
              Add relationship group
            </button>
          </aside>
        </div>
      )}
      {view === 'commitments' &&
        (commitments.length ? (
          <div className="commitment-list">
            {commitments.map((c) => (
              <CommitmentCard key={c.id} commitment={c} />
            ))}
          </div>
        ) : (
          <Empty
            title="No open commitments"
            text="Record something you’re waiting on, or a promise you’ve made."
          />
        ))}
      {view === 'upcoming' && (
        <section className="people-directory">
          {upcomingDates(s, now)
            .filter((d) => {
              const p = s.people.find((p) => p.id === d.personId);
              return p && matches(p);
            })
            .map((d) => (
              <button
                className="person-row"
                key={d.id}
                onClick={() => update('person', d.personId)}
              >
                <span className="occasion-day mono">{d.date.slice(5)}</span>
                <span className="person-name">
                  <strong>{s.people.find((p) => p.id === d.personId)?.name}</strong>
                  <small>{d.title}</small>
                </span>
                <span>{d.advance ? 'Day of + 7 days before' : 'Day-of reminder'}</span>
              </button>
            ))}
          {!upcomingDates(s, now).some((d) => {
            const p = s.people.find((p) => p.id === d.personId);
            return p && matches(p);
          }) && (
            <Empty
              title="No upcoming dates"
              text="Add birthdays, anniversaries or milestones from a contact’s profile."
            />
          )}
        </section>
      )}
      {selected && <PersonPanel person={selected} onClose={() => update('person', '')} />}
      {importing && <PeopleImport onClose={() => setImporting(false)} />}
    </>
  );
}
function PersonPanel({ person, onClose }: { person: Person; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="task-panel"
      aria-label={`Person: ${person.name}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="panel-bar">
        <span className="eyebrow">PERSON DETAILS</span>
        <div>
          <Link
            href={`/people/${person.id}`}
            aria-label="Open person full page"
            className="icon-button"
          >
            <ArrowUpRight size={18} />
          </Link>
          <button className="icon-button" aria-label="Close person" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
      </div>
      <PersonDetail person={person} panel />
    </dialog>
  );
}
export function PersonDetail({ person: p, panel = false }: { person: Person; panel?: boolean }) {
  const a = usePeopleActions(),
    s = a.state,
    [tab, setTab] = useState('overview');
  const commitments = s.commitments.filter((c) => c.personId === p.id),
    interactions = s.interactions
      .filter((i) => i.personId === p.id)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    dates = s.importantDates.filter((d) => d.personId === p.id);
  return (
    <div className="person-detail">
      {!panel && (
        <Link className="text-link" href="/people">
          <ArrowLeft size={16} />
          All people
        </Link>
      )}
      <div className="person-hero">
        <Avatar name={p.name} />
        <div>
          <span className="eyebrow">
            {s.relationshipGroups.find((g) => g.id === p.groupId)?.name} · {p.status}
          </span>
          <h1>{p.name}</h1>
          <p>{[p.role, p.organization].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <div className="button-row">
        <button className="button" onClick={() => a.interaction(p.id)}>
          Log interaction
        </button>
        <button className="button secondary" onClick={() => a.commitment(p.id)}>
          New commitment
        </button>
        <button className="button secondary" onClick={() => a.editPerson(p)}>
          Edit contact
        </button>
      </div>
      <div className="people-tabs" aria-label="Contact sections">
        {['overview', 'interactions', 'commitments', 'activity'].map((v) => (
          <button
            key={v}
            aria-pressed={tab === v}
            className={tab === v ? 'selected' : ''}
            onClick={() => setTab(v)}
          >
            {v[0].toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>
      <h2 className="sr-only">
        {tab === 'overview'
          ? 'Contact overview'
          : tab === 'interactions'
            ? 'Interaction history'
            : tab === 'commitments'
              ? 'Contact commitments'
              : 'Contact activity'}
      </h2>
      {tab === 'overview' && (
        <>
          <section className="section">
            <div className="people-contact-grid">
              {(['emails', 'phones', 'links'] as const).map((k) => (
                <div key={k}>
                  <span className="eyebrow">{k}</span>
                  {p[k].length ? (
                    p[k].map((v, i) => (
                      <p key={i}>
                        <small>{v.label}</small>
                        <br />
                        {k === 'links' ? (
                          <a href={v.value} target="_blank" rel="noreferrer">
                            {v.value}
                          </a>
                        ) : (
                          v.value
                        )}
                      </p>
                    ))
                  ) : (
                    <p className="muted">Not added</p>
                  )}
                </div>
              ))}
            </div>
            <div className="button-row">
              {p.tags.map((t) => (
                <span className="badge" key={t}>
                  {t}
                </span>
              ))}
            </div>
            <h2>Relationship notes</h2>
            <p className="prewrap">{p.notes || 'Add the context you want to remember.'}</p>
            <p className="muted">
              Next contact: {nextContactDate(s, p.id) ?? 'Not scheduled'} ·{' '}
              {p.cadenceMode === 'inherit'
                ? 'Group cadence'
                : p.cadenceMode === 'paused'
                  ? 'Reminders paused'
                  : `Every ${p.cadenceDays} days`}
            </p>
          </section>
          <section className="section">
            <div className="section-title">
              <h2>Important dates</h2>
              <button className="button secondary small" onClick={() => a.importantDate(p.id)}>
                Add date
              </button>
            </div>
            {dates.map((d) => (
              <button className="group-row" key={d.id} onClick={() => a.importantDate(p.id, d)}>
                <strong>
                  {d.title}
                  {!d.active ? ' · disabled' : ''}
                </strong>
                <span>
                  {d.month}/{d.day}
                  {d.year ? `/${d.year}` : ''}
                  {d.advance ? ' · advance notice' : ''}
                </span>
              </button>
            ))}
            {!dates.length && <p className="muted">Birthdays can be saved without a birth year.</p>}
          </section>
          <button
            className="text-link"
            disabled={a.pending}
            onClick={() =>
              void a.run('person.update', {
                entityId: p.id,
                expectedVersion: p.version,
                status: p.status === 'active' ? 'archived' : 'active',
                reason:
                  p.status === 'active'
                    ? 'Archived contact; unresolved commitments remain visible'
                    : 'Restored contact',
              })
            }
          >
            {p.status === 'active' ? 'Archive contact' : 'Restore contact'}
          </button>
        </>
      )}
      {tab === 'interactions' && (
        <section className="section">
          {interactions.length ? (
            interactions.map((i) => (
              <article className="compact-card" key={i.id}>
                <div className="row-between">
                  <strong>
                    {i.channel} ·{' '}
                    {new Date(i.occurredAt).toLocaleString('en', { timeZone: s.timezone })}
                  </strong>
                  <button className="text-link" onClick={() => a.interaction(p.id, i)}>
                    Correct
                  </button>
                </div>
                <p className="prewrap">{i.summary}</p>
                <small>
                  {i.voided ? 'Voided' : i.meaningful ? 'Meaningful contact' : 'Context only'} ·
                  Logged by {a.who(i.actorId)}
                </small>
                {i.source && <p className="muted">Source: {i.source}</p>}
              </article>
            ))
          ) : (
            <Empty
              title="No interactions logged"
              text="Capture a conversation and the context worth remembering."
            />
          )}
        </section>
      )}
      {tab === 'commitments' &&
        (commitments.length ? (
          commitments.map((c) => <CommitmentCard key={c.id} commitment={c} />)
        ) : (
          <Empty
            title="No commitments yet"
            text="Keep requests and promises connected to this person."
          />
        ))}
      {tab === 'activity' &&
        a.activity([
          p.id,
          ...interactions.map((i) => i.id),
          ...commitments.map((c) => c.id),
          ...dates.map((d) => d.id),
        ])}
    </div>
  );
}
export function CommitmentCard({
  commitment: c,
  controls = true,
}: {
  commitment: Commitment;
  controls?: boolean;
}) {
  const a = usePeopleActions();
  return (
    <article className="compact-card commitment-card">
      <div className="row-between">
        <span className={`commitment-direction ${c.direction}`}>
          {c.direction === 'waiting_on' ? 'Waiting on them' : 'I owe them'}
        </span>
        <span className="badge">{c.status.replaceAll('_', ' ')}</span>
      </div>
      <h3>{c.title}</h3>
      <p>
        <Link href={`/people/${c.personId}`}>{a.who(c.personId)}</Link> · Coordinated by{' '}
        {a.who(c.coordinatorId)}
      </p>
      <div className="commitment-meta">
        <span>Promised: {c.promisedDate ?? 'Not agreed'}</span>
        <span>
          Follow-up:{' '}
          {c.followUpAt
            ? new Date(c.followUpAt).toLocaleString('en', { timeZone: a.state.timezone })
            : 'Not scheduled'}
        </span>
        <span>{c.priority} priority</span>
      </div>
      {c.note && <p className="prewrap">{c.note}</p>}
      {c.source && <p className="muted">Source: {c.source}</p>}
      <div className="button-row">
        {c.workstreamId && (
          <Link className="text-link" href={`/tasks/${c.workstreamId}`}>
            {c.required ? 'Required for task' : 'Linked task'} ↗
          </Link>
        )}
        {c.projectId && (
          <Link className="text-link" href={`/projects/${c.projectId}`}>
            Project ↗
          </Link>
        )}
        {controls && (
          <>
            <button className="button secondary small" onClick={() => a.transition(c)}>
              Update state
            </button>
            <button className="text-link" onClick={() => a.commitment(c.personId, c)}>
              Edit commitment
            </button>
          </>
        )}
      </div>
    </article>
  );
}
export function PeopleAttention({
  items,
  actions = true,
}: {
  items: PeopleQueueItem[];
  actions?: boolean;
}) {
  const a = usePeopleActions();
  return (
    <div className="people-attention">
      {items.map((q) => {
        const p = a.state.people.find((p) => p.id === q.personId),
          c = a.state.commitments.find((c) => c.id === q.commitmentId);
        return (
          <section className="compact-card" key={q.id}>
            <Link className="text-link" href={`/people/${q.personId}`}>
              {p?.name ?? 'Contact'} ↗
            </Link>
            {actions && <h3>{q.title}</h3>}
            <p>{q.reasons.join(' · ')}</p>
            {q.snoozedUntil && (
              <p className="muted">Snoozed until {new Date(q.snoozedUntil).toLocaleString()}</p>
            )}
            {c ? <CommitmentCard commitment={c} controls={false} /> : null}
            {actions && <PeopleReminderActions item={q} />}
          </section>
        );
      })}
    </div>
  );
}
export function TaskCommitments({ taskId }: { taskId: string }) {
  const a = usePeopleActions();
  return (
    <section className="section">
      <div className="section-title">
        <h2>People & commitments</h2>
        <button
          className="button secondary small"
          onClick={() => a.commitment(undefined, undefined, taskId)}
        >
          Add commitment
        </button>
      </div>
      {a.state.commitments
        .filter((c) => c.workstreamId === taskId)
        .map((c) => (
          <CommitmentCard key={c.id} commitment={c} />
        ))}
      <p className="muted">
        Required commitments must be fulfilled or waived before this task can finish.
      </p>
    </section>
  );
}

export function PeopleReminderActions({ item: q }: { item: PeopleQueueItem }) {
  const a = usePeopleActions(),
    commitment = a.state.commitments.find((c) => c.id === q.commitmentId);
  return (
    <div className="button-row">
      {commitment && (
        <button className="button secondary small" onClick={() => a.transition(commitment)}>
          Update state
        </button>
      )}
      {commitment && (
        <button
          className="button secondary small"
          onClick={() => a.commitment(commitment.personId, commitment)}
        >
          Edit commitment
        </button>
      )}
      {q.category === 'occasion' && (
        <button
          className="button secondary small"
          disabled={a.pending}
          onClick={() =>
            void a.run('people_reminder.respond', {
              entityId: q.subjectId,
              expectedVersion: q.version,
              occurrenceKey: q.occurrenceKey,
              response: 'acknowledged',
              reason: 'Acknowledged this occasion reminder',
            })
          }
        >
          Acknowledge
        </button>
      )}
      <button className="button secondary small" onClick={() => a.interaction(q.personId)}>
        Log contact
      </button>
      <button className="text-link" onClick={() => a.snooze(q)}>
        Snooze reminder
      </button>
      <button className="button quiet small" disabled={a.pending} onClick={() => a.dismiss(q)}>
        <X size={16} />
        Dismiss
      </button>
    </div>
  );
}
