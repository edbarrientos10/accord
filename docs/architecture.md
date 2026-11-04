# Domain and architecture

## Sources of truth

Accord owns coordination: desired outcomes, next actions, authority, history,
and closure evidence. External systems retain their specialized objects.
References identify the system, object, responsibility, observed status and
check time. Conflicts are recorded for owner reconciliation. No automatic
task import, chat surveillance, external URL fetching, or universal sync occurs.

## Transaction model

Web and API commands use `src/domain/service.ts`; MCP tools call the same service.
Zod schemas reject unknown command fields. Clients cannot provide the actor.
The server resolves it from a Supabase owner session or a hashed opaque token.

PostgreSQL stores workspaces, identities, workstreams, operations, actions,
grants, executions, evidence, audit events and idempotency records in separate
tables. Foreign keys retain workspace and parent relationships. Each current
record contains a validated, extensible JSON payload alongside relational keys,
version and relevant indexed fields.

A command loads a consistent snapshot, validates it, and submits the resulting
state with its expected workspace revision. The commit RPC locks the workspace,
checks the revision and credential, and writes current records, every material
audit event, and the retry result in one transaction. A competing write causes
reevaluation; stale entity versions still fail. This deliberately serializes
writes within a personal workspace and rewrites its current records. It is not
full event sourcing, and it is not optimized for enterprise-scale histories.

Idempotency is actor-scoped and content-bound. Preserve a retry key for the same
intent; different content with that key fails. Database failures commit no
partial domain state. Object storage cannot share the database transaction:
an upload interrupted before attachment can leave an unregistered private file.
Do not delete such files without checking current references and active uploads.

## Authority and evidence

Only the human owner grants execution authority or changes existing task criteria. Workspace agents with explicit management capabilities may organize assignments. One-time
approval names one immutable action revision. Standing permission names exact
operations and targets, grantee, validity, maximum uses and optional declared
cost limit. Starting an attempt consumes usage atomically, even if it fails.
It never executes the external action itself.

Running and uncertain attempts block another attempt for that action or
operation. Reconciliation needs accepted evidence tied to the attempt. A
one-time grant stays consumed after reconciliation; repeating needs new human
authority. Results distinguish observed success, partial success, failure and
uncertainty from evidence verification.

Evidence starts unverified. The human can accept it; a separately provisioned
integration with `evidence.verify` may independently attest evidence in its
explicit assignments. Agent credentials cannot receive that capability, and
integrations cannot attest their own attempt. Integration verification is an
authenticated assertion by that configured verifier, not a universal guarantee
that external content is correct. Initial use relies on human acceptance.

Assigned agents may close when every criterion has trusted evidence and no
blocker, active/uncertain attempt, or external conflict remains. Human closure
records criterion evidence or explicit attributable confirmation. Sending a
proposal does not establish acceptance. Completion, cancellation and dismissal
are distinct; corrections retain history. Invalidating accepted evidence returns
a completed workstream to review.

## Security boundaries

One explicitly installed human owner per instance; third parties have no login.
Agents and verifier integrations have distinct identities and credentials.
Tokens expire in 90 days by default and are displayed once, hashed at rest,
explicitly scoped/assigned, and checked for revocation on every request and at
domain transaction commit. Supabase validates human sessions; verified MFA
factors require an `aal2` session.

RLS allows owner reads and denies direct client writes. Agent access goes only
through the controlled API/MCP service. Credential tables are unavailable to
clients. Private Storage has no public or client policies; authorized downloads
use 60-second links. URLs and document contents cannot change authority. React
renders content as text and references accept HTTP(S) only.

The service-role key is privileged. Compromise of the server or that key bypasses
these application guarantees. No guarantee is made about actions performed
outside Accord, external cost declarations, or reversing external effects.
Application error responses redact provider internals; application code does
not log request bodies, tokens or evidence. Audit history is private data.

## Extension contracts

Add integration identities and narrowly scoped adapters without importing a
runtime into the domain. An adapter may report observations or verify evidence
within its assignment. Scheduling controls require a real adapter capability;
v1 has none. Additional clients must call the same command service rather than
write tables. See the generated API schemas for validation and effects.

## Project/task redesign

Projects group existing workstreams without changing record identifiers or
authority boundaries. Separate planning stage and completion-policy fields
extend the task contract; lifecycle commands still enforce blockers, execution
uncertainty, criteria and ownership. Immutable decision records and version-bound
reminders are included in the atomic snapshot transaction. Project context is
filtered through existing task assignments. See [redesign](redesign.md) for the
public contract, archive compatibility, upgrade sequence, and UI architecture.

## Persistent navigation frame

The root layout owns `WorkspaceFrame`, which retains the workspace provider,
auth subscription, loaded data, and application shell across menu navigation.
The catch-all page renders only the selected feature view. The initial loading
screen appears when opening the app, rather than on every section change.
Commands and the explicit refresh control reload the shared snapshot. Route
changes clear transient dialogs, notices, and newly issued credential displays;
signing out clears the workspace and cached credentials.

## People

The People domain extends the same command/snapshot transaction. Profiles share
third-party identity IDs; they never become authentication principals. Directory
permissions and task assignments remain independent. Relationship reminders are
pure timezone-aware projections shared by Today, REST and MCP. See [People](people.md)
for lifecycle, import, permission and migration details.

## Bounded activity reads and request diagnostics

The current snapshot function excludes audit_events entirely. UI state reads,
authentication, and domain commands use it; commands commit only the newly
produced audit events. Legacy full snapshots remain for compatibility and
archives. The immutable audit insert trigger creates compact activity_log
summaries in the same transaction. Independent failed-attempt writes use the
same owner-only indexed feed without altering domain state or revision.

The log API uses keyset pagination and indexed filters. A page never contains
before/after snapshots; detail retrieval reads one event by workspace and ID.
Failed REST/MCP calls are observed at the interface boundary, including MCP SDK
input validation. Attempt metadata is allowlisted and size bounded. A timed-out
log sink cannot replace the original error. See [Logs](logs.md) for details.

## Workspace agent authorization

Credential `access_mode` defaults to `assigned`. The optional `Actor.accessMode` defaults to assigned semantics for legacy callers. Shared record-access checks allow workspace agents across current and future records, while exact command capabilities, field-level safeguards, execution grants, and People scopes remain independent. The same checks serve REST and MCP, command retries, linked People context, and authorized state projections. Workspace management never converts an agent into a human owner. Agent archive exports and indexed Logs remain forbidden.
