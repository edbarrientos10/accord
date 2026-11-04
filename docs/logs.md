# Inspecting agent activity

Open **Logs** in the sidebar, or choose **View activity** on an agent's card.
The default is agents and integrations; Everyone includes the human owner.
Filter by actor, command, outcome, calendar date, related record, or search words.
Dates use the workspace timezone. Filters, selected events, and page cursors
remain in the URL.

## Changes and unsuccessful attempts

Saved changes come from Accord's append-only audit trail. A command can change
several records, each with before/after values. Idempotent successful retries
reuse the original result and do not duplicate these changes.

Unsuccessful requests are separate append-only events. Coverage includes:

- REST domain commands, including malformed JSON, oversized bodies, invalid
  retry keys, validation failures, denied scope/assignment, stale versions,
  lifecycle rejection, and persistence failures.
- MCP tool invocations, including SDK validation and tools unavailable to the
  credential, before a command handler runs.
- Failed REST state/attention reads and MCP query/attention calls. Successful
  read-only calls are not logged.
- Expired or revoked agent credentials when their stored token hash identifies
  the agent. This attribution never grants access. MCP authentication rejection
  occurs before tool parsing, so its command is shown as unknown.command.

Each rejected retry gets its own event ID. An actor-scoped hashed retry reference connects
attempts by the same identity that used the same key. Logs show error category/code, interface,
duration, optional target ID, and safe validation field names. Request bodies,
raw retry keys, tokens, headers, raw provider errors, and stack traces are not
stored. Unknown credentials cannot be attributed to a workspace and are not
recorded. External runtime activity remains outside Accord's visibility.

Reported execution failure and a rejected Accord request are different outcomes.
A service failure does not prove rollback: the response may have been lost after
a successful commit. Inspect current state and retry with the same idempotency
key. A reported execution success is still not independent verification.

Failure logging is independent of the domain transaction and never changes
workspace revision, permission, or lifecycle. Its database write has a 1.5-second
timeout. If persistence is unavailable, the original request error is preserved,
a sanitized operational fallback is emitted to the server log, and command REST
responses expose X-Accord-Log-Status or MCP results expose accord/logStatus in
_meta. A database outage can prevent an attempt from appearing in the UI; logs
are not an infallible external telemetry service. Diagnostic read failures do
not recursively create log events.

## Performance and access

The production UI requests `/api/v1/state?history=none`. Authentication,
attention, credential validation, and command execution use a current snapshot
that never queries audit history. Command commits append only new audit events;
they do not resend or iterate over the old history.

An insert trigger indexes compact audit summaries in activity_log. Failed
attempts use the same feed. Indexes cover workspace/time/ID order, agent-only
history, individual actors, commands, outcomes, record context and full-text
search. Queries use keyset cursors, never deep OFFSET or total-count scans.
The UI holds one page of 50 summaries; the API caps pages at 100. Full changes
are fetched only for the selected event. Task/person/routine history also loads
a bounded page, with a link to the full paginated inspector.

While visible, the newest page refreshes every 15 seconds. Older pages stay
stable until you return to Newest activity. Filter edits are debounced; obsolete
requests are cancelled. Refresh preserves the shell and selection. Errors retain
the last loaded page. Large details are rendered in scrollable field panels.

Diagnostics are owner-only: GET /api/v1/logs and GET /api/v1/logs/{id} require
the authenticated workspace owner. Agents receive their normal command errors;
existing scopes do not gain diagnostic or cross-task access. Owner-read RLS and
workspace predicates also protect the underlying feed. Existing scoped audit
reads and explicit full exports retain their authorization rules.

For compatibility, GET /api/v1/state without history=none and accord_query with
includeHistory=true still return historical audit data. Prefer includeHistory=false
for ordinary agent state queries. Full exports intentionally read full history.

## Migration and recovery

1. Back up the installed database and test changes in an isolated local copy.
2. Apply existing migrations in order, then
   `supabase/migrations/202610260003_activity_logs.sql`, after the People migration.
   Do not reset an existing workspace.
3. This adds the compact snapshot function and activity feed, backfills summaries
   for existing audit events, and installs the append-only indexing trigger.
   Backfill work scales with existing history; allow a maintenance window for a
   large database. No historical audit or record IDs are replaced.
4. Start the matching application build. Verify a stale-version rejection,
   denied agent command, successful command retry, paginated history, and owner
   isolation before considering a hosted rollout.

Failed attempts begin with this version; old failures cannot be reconstructed.
The feed has no automatic destructive retention. Database backups include it.
accord.v1/v2/v3 logical archives preserve domain audit history but exclude
operational failed-attempt diagnostics; restoring their audit events rebuilds
saved-change summaries through the trigger. Preserve a database backup when
request diagnostics must also be retained.

## Local validation

The populated migration check inserts 20,000 audit events, verifies the compact
snapshot stays exactly the same size, checks bounded summary pages and cursor
stability under new inserts, and confirms an indexed ordered query plan. It also
checks owner RLS, denied client mutation, legacy audit preservation, append-only
behavior, and atomic command deltas. REST/MCP tests cover pre-handler rejection,
service errors, safe metadata, retry attribution, and log-storage failure.
Browser checks cover 50-row pages, detail-on-demand, failed-attempt inspection,
automatic refresh without state reloads, filters, accessibility and mobile use.
These are local results, not hosted throughput or deployment acceptance.
