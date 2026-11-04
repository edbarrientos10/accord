'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowUpRight, Clock3, RefreshCw } from 'lucide-react';
import { activityChanges, fields, inspectable } from '../../domain/activity';
import { logOutcomes, type LogDetail } from '../../domain/log-types';
import { agentScopes, humanOnly, workspaceCommandScopes } from '../../domain/permissions';
import { useWorkspace } from '../workspace/context';
import { useLogPage } from '../workspace/use-log-page';
import { Avatar, Empty, Heading } from '../workspace/ui';
function value(v: unknown) {
  if (v === undefined) return 'Not set';
  if (v === null) return 'None';
  return typeof v === 'string' ? v || '(empty)' : JSON.stringify(v, null, 2);
}
export function Logs() {
  const { state, request } = useWorkspace(),
    params = useSearchParams(),
    router = useRouter();
  const [live, setLive] = useState(true),
    [detail, setDetail] = useState<LogDetail>(),
    [detailError, setDetailError] = useState(''),
    [detailRetry, setDetailRetry] = useState(0);
  const list = useRef<HTMLElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    rows = useRef(new Map<string, HTMLButtonElement>()),
    previous = useRef<string | null>(null);
  const listParams = new URLSearchParams(params);
  listParams.delete('event');
  listParams.set('limit', '50');
  const cursor = params.get('cursor'),
    eventId = params.get('event');
  const { page, loading, error, checked, refresh } = useLogPage(
    listParams.toString(),
    live && !cursor,
  );
  const filters = {
    actor: params.get('actor') ?? 'agents',
    command: params.get('command') ?? '',
    outcome: params.get('outcome') ?? '',
    query: params.get('q') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
  };
  const update = (key: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(key, v);
    else p.delete(key);
    if (key !== 'event') p.delete('event');
    if (key !== 'event' && key !== 'cursor') p.delete('cursor');
    if (key === 'cursor') router.push('/logs?' + p, { scroll: false });
    else router.replace('/logs?' + p, { scroll: false });
  };
  useEffect(() => {
    setDetail(undefined);
    setDetailError('');
    if (!eventId) return;
    const c = new AbortController();
    void request('/api/v1/logs/' + encodeURIComponent(eventId), { signal: c.signal })
      .then((d) => {
        if (!c.signal.aborted) setDetail(d);
      })
      .catch((e) => {
        if (!c.signal.aborted) setDetailError(e.message);
      });
    return () => c.abort();
  }, [eventId, request, detailRetry]);
  useEffect(() => {
    if (eventId) heading.current?.focus();
    else if (previous.current) rows.current.get(previous.current)?.focus();
    previous.current = eventId;
  }, [eventId, detail]);
  const timestamp = (at: string) =>
    new Date(at).toLocaleString('en', {
      timeZone: state.timezone,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
  useEffect(() => {
    if (list.current) list.current.scrollTop = 0;
  }, [listParams.toString()]);
  const selected = detail?.summary.id === eventId ? detail.summary : undefined,
    diff = detail?.event ? activityChanges(detail.event) : [],
    attempt = detail?.attempt;
  const related = selected?.contextIds
    .map((id) => {
      if (state.workstreams.some((w) => w.id === id)) return `/tasks/${id}`;
      if (state.people.some((p) => p.id === id)) return `/people/${id}`;
      if (state.operations.some((o) => o.id === id)) return `/routines/${id}`;
      if (state.projects.some((p) => p.id === id)) return `/projects/${id}`;
    })
    .find(Boolean);
  return (
    <div className={eventId ? 'logs-page inspecting' : 'logs-page'}>
      <Heading
        eyebrow="WORKSPACE ACTIVITY"
        title="Logs"
        subtitle="Inspect saved changes, rejected commands, and attempts that failed."
        action={
          <button className="button secondary" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw size={16} />
            {loading ? 'Refreshing…' : 'Refresh logs'}
          </button>
        }
      />
      <div className="logs-status">
        <span>
          <Clock3 size={15} />
          {cursor
            ? 'Viewing older activity'
            : live
              ? 'Updates every 15 seconds'
              : 'Automatic updates paused'}
          {checked ? ` · Checked ${timestamp(checked)}` : ''}
        </span>
        <button className="text-link" onClick={() => setLive(!live)}>
          {live ? 'Pause updates' : 'Resume updates'}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          Could not refresh logs. Showing the last loaded activity. {error}
        </p>
      )}
      <div className="logs-filters">
        <label>
          Search
          <input
            value={filters.query}
            placeholder="Search words, action or ID…"
            onChange={(e) => update('q', e.target.value)}
          />
        </label>
        <label>
          Actor
          <select value={filters.actor} onChange={(e) => update('actor', e.target.value)}>
            <option value="agents">Agents & integrations</option>
            <option value="all">Everyone</option>
            {state.identities
              .filter((i) => i.kind !== 'third_party')
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Action
          <select value={filters.command} onChange={(e) => update('command', e.target.value)}>
            <option value="">All actions</option>
            {[
              ...new Set([
                ...agentScopes,
                ...workspaceCommandScopes,
                ...humanOnly,
                'evidence.verify',
              ]),
              'query',
              'attention.query',
              'credential.create',
              'credential.revoke',
              'unknown.command',
            ]
              .sort()
              .map((c) => (
                <option key={c}>{c}</option>
              ))}
          </select>
        </label>
        <label>
          Outcome
          <select value={filters.outcome} onChange={(e) => update('outcome', e.target.value)}>
            <option value="">All outcomes</option>
            {Object.entries(logOutcomes).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            value={filters.from}
            onChange={(e) => update('from', e.target.value)}
          />
        </label>
        <label>
          Through
          <input type="date" value={filters.to} onChange={(e) => update('to', e.target.value)} />
        </label>
      </div>
      <div className="logs-summary">
        <span>
          {page.items.length} events on this page · {state.timezone}
          {params.has('entity') ? ' · Related record' : ''}
        </span>
        <Link className="text-link" href="/logs?actor=all">
          Clear filters
        </Link>
      </div>
      <div className={`logs-workspace ${eventId ? 'logs-detail-open' : ''}`}>
        <section
          ref={list}
          className="logs-list"
          aria-label="Recorded activity"
          aria-busy={loading}
        >
          <h2 className="sr-only">Recorded activity</h2>
          {!page.items.length ? (
            <Empty
              title={loading ? 'Loading activity…' : 'No matching activity'}
              text="Agent changes and authenticated command failures appear here. Try Everyone or clear the filters."
            />
          ) : (
            page.items.map((entry) => (
              <button
                key={entry.id}
                ref={(node) => {
                  if (node) rows.current.set(entry.id, node);
                  else rows.current.delete(entry.id);
                }}
                className={`log-row ${eventId === entry.id ? 'selected' : ''}`}
                aria-pressed={eventId === entry.id}
                onClick={() => update('event', entry.id)}
              >
                <span className="log-row-top">
                  <Avatar name={entry.actorName} agent={entry.actorKind !== 'human'} />
                  <strong>{entry.actorName}</strong>
                  <span className={`log-outcome outcome-${entry.outcome}`}>
                    {logOutcomes[entry.outcome as keyof typeof logOutcomes] ?? entry.outcome}
                  </span>
                </span>
                <span className="log-title">{entry.title}</span>
                <code>{entry.command}</code>
                <time dateTime={entry.at}>{timestamp(entry.at)}</time>
              </button>
            ))
          )}
          <div className="logs-pagination">
            {cursor && (
              <button className="button secondary" onClick={() => update('cursor', '')}>
                Newest activity
              </button>
            )}
            {page.nextCursor && (
              <button
                className="button secondary"
                disabled={loading}
                onClick={() => update('cursor', page.nextCursor!)}
              >
                Older activity
              </button>
            )}
          </div>
        </section>
        <section className="log-detail" aria-label="Activity details">
          <button className="text-link log-back" onClick={() => update('event', '')}>
            <ArrowLeft size={16} />
            Back to logs
          </button>
          {detailError ? (
            <div>
              <p className="error" role="alert">
                {detailError}
              </p>
              <button className="button secondary" onClick={() => setDetailRetry((n) => n + 1)}>
                Retry event details
              </button>
            </div>
          ) : selected ? (
            <>
              <span className="eyebrow">{attempt ? 'COMMAND ATTEMPT' : 'RECORDED CHANGE'}</span>
              <h2 ref={heading} tabIndex={-1}>
                {selected.title}
              </h2>
              <p className="muted">
                {selected.actorName} · {timestamp(selected.at)}
              </p>
              <div className="log-command">
                <code>{selected.command}</code>
                <span className={`log-outcome outcome-${selected.outcome}`}>
                  {logOutcomes[selected.outcome as keyof typeof logOutcomes] ?? selected.outcome}
                </span>
              </div>
              <h3>{attempt ? 'Why it did not complete' : 'Reason'}</h3>
              <p className="prewrap">{detail?.event?.reason ?? selected.reason}</p>
              {attempt ? (
                <>
                  <dl className="attempt-facts">
                    <dt>Error code</dt>
                    <dd>
                      <code>{attempt.code}</code>
                    </dd>
                    <dt>Interface</dt>
                    <dd>{attempt.transport.toUpperCase()}</dd>
                    <dt>Duration</dt>
                    <dd>{attempt.durationMs} ms</dd>
                    <dt>Retry reference</dt>
                    <dd>
                      <code>{attempt.retryReference ?? 'No retry key provided'}</code>
                    </dd>
                    {attempt.validationFields.length > 0 && (
                      <>
                        <dt>Fields to check</dt>
                        <dd>{attempt.validationFields.join(', ')}</dd>
                      </>
                    )}
                  </dl>
                  <p className="notice">
                    {attempt.outcome === 'error'
                      ? 'The result could not be confirmed. Inspect the related record and reuse the same retry key before attempting the operation again.'
                      : 'This invocation was rejected. Review the error and current permissions or record version before retrying.'}
                  </p>
                </>
              ) : (
                <>
                  {selected.outcome !== 'recorded' && (
                    <p className="notice">
                      This is the execution state recorded at this moment. A reported success is not
                      independent verification.
                    </p>
                  )}
                  <h3>
                    What changed{' '}
                    <span className="muted">
                      · {diff.length} {diff.length === 1 ? 'field' : 'fields'}
                    </span>
                  </h3>
                  {fields(detail?.event?.changes).redacted ? (
                    <p className="muted">Change details are restricted by your access.</p>
                  ) : diff.length ? (
                    <div className="log-diff">
                      <div className="log-diff-heading">
                        <span>Before</span>
                        <span>After</span>
                      </div>
                      {diff.map((d) => (
                        <div className="log-field" key={d.key}>
                          <h4>{d.key.replace(/([a-z])([A-Z])/g, '$1 $2')}</h4>
                          <div className="log-values">
                            <pre aria-label={`${d.key} before`}>{value(d.before)}</pre>
                            <pre aria-label={`${d.key} after`}>{value(d.after)}</pre>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">No field-level details were recorded.</p>
                  )}
                </>
              )}
              {related && (
                <Link className="text-link" href={related}>
                  Open related record <ArrowUpRight size={15} />
                </Link>
              )}
              <details className="log-raw">
                <summary>Event identifiers and recorded data</summary>
                <p>
                  Event <code>{selected.id}</code>
                  <br />
                  Record <code>{selected.entityId ?? 'Not specified'}</code>
                  <br />
                  Actor <code>{selected.actorId}</code>
                </p>
                <pre>{JSON.stringify(inspectable(attempt ?? detail?.event?.changes), null, 2)}</pre>
              </details>
            </>
          ) : (
            <Empty
              title={eventId ? 'Loading event…' : 'Select an event'}
              text="Choose a saved change or command attempt to inspect its details."
            />
          )}
        </section>
      </div>
      <p className="logs-footnote">
        Logs include saved changes, execution reports, and attributable REST/MCP request failures
        from this version onward. Each failed retry is a separate attempt; matching retry references
        connect them. Successful reads, unknown credentials, and work outside Accord are not
        recorded. Request bodies and credential secrets are excluded.
      </p>
    </div>
  );
}
