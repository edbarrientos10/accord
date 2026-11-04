# API and MCP

Start with the [agent operating guide](agent-guide.md) for a full workflow and
[command reference](commands.md) for roles and version targets. Public machine-readable
metadata is at `/docs/agent-manifest.json`; schema discovery is at `/llms.txt`.

Every endpoint requires an owner Supabase access token or an opaque Accord agent
token, except a read-only fictional preview. Bearer credentials belong in the
Authorization header. Browser origins must match `ACCORD_ORIGIN`.

## REST

- `GET /api/v1/state`: current workstreams, operations, related records and audit
  history filtered to the caller's scopes and record access mode.
- `POST /api/v1/commands/COMMAND`: JSON command input, with `Idempotency-Key`.
  Returns `{ "result": RECORD }`. Existing records require `expectedVersion`;
  parent-based creation uses its parent's current version.
- `GET /api/v1/credentials`: owner-only credential metadata, excluding hashes.
- `POST /api/v1/credentials`: owner-only issuance with `identityId`, explicit
  `scopes`, `assignments`, optional `accessMode` (`assigned` by default or agent-only `workspace`), optional `expiresAt`, and `Idempotency-Key`. The token
  is returned once. Equivalent retries return metadata, never the original
  token; revoke and replace it if the first response was lost.
- `DELETE /api/v1/credentials/ID`: owner-only revocation with current version in
  `If-Match` and `Idempotency-Key`.
- `POST /api/v1/evidence/upload`: authenticated multipart `file` and JSON
  `metadata` containing the `evidence.attach` fields and parent version, with
  `Idempotency-Key`. The server supplies the path and SHA-256. Up to 3 MiB.
- `GET /api/v1/evidence/ID/download`: requires read access to the evidence's
  parent; returns a private URL valid for 60 seconds. Do not log the URL.
- `POST /api/v1/export`: owner-only, explicit `{ "ids": [PROJECT_TASK_OR_ROUTINE_IDS] }`.
  Includes related evidence bytes and history. Operation exports include their
  linked incidents. Does not include credentials or owner authentication IDs.

See [generated OpenAPI command schemas](openapi.json). Regenerate with
`npm run schema`. Schema refinements such as exclusive parent selection and
state-dependent permissions are additionally enforced by the command service.

Errors use `{ "error": { "code", "message", "details" } }`. A `conflict`
includes the current entity version when available: reload, reconcile, and use
a new intent key. `idempotency_mismatch` means content changed under an existing
key. `reconciliation_required` forbids potentially duplicative execution.
An HTTP success records a coordination event, not an external system effect.

## MCP

`POST /mcp` implements stateless Streamable HTTP using the official MCP SDK.
Each request authenticates independently; GET streaming and DELETE sessions are
not supported. `accord_query` accepts optional `entityId` and `includeHistory` (default true).
Prefer `includeHistory: false` for normal reads. `accord_attention` accepts `{}`.
Both return JSON in MCP text content blocks. Query returns state; attention returns
an item array. REST state wraps `{state, actor}`, and REST attention wraps `{items}`.

Command tools use `accord_` plus the command name with dots replaced by
underscores, e.g. `accord_action_propose`. Arguments are:

```json
{
  "input": { "workstreamId": "UUID", "expectedVersion": 1 },
  "idempotencyKey": "persist-this-key-for-equivalent-retries"
}
```

The input must contain all fields in that command's schema. Tool discovery
exposes capabilities permitted by the authenticated identity; command checks
still enforce human-only decisions, credential record access, capabilities and versions. Domain errors are
JSON text content with `isError: true` and the same error codes as REST.
Use the HTTP upload endpoint for file evidence; direct object-path claims are
rejected from public commands and MCP.

## Minimal agent workflow

1. Query the assigned workstream and note its version and closure criteria.
2. Propose the exact operation, effect, target, content, scope, expiry and any
   declared cost; request approval on that action revision.
3. The human reviews and approves through Today. Query the resulting grant
   and current action version; the agent cannot approve itself.
4. Start an execution to reserve authority before performing the external action
   in the agent's own runtime. Report the observed result and external identifier.
5. Attach evidence and submit for review. The human accepts the evidence;
   the assigned agent may then close only if every criterion is satisfied.
6. If a result is ambiguous, report `uncertain`; attach lookup/reconciliation
   evidence and wait for its acceptance before reconciling. Do not repeat the
   sensitive action merely because a transport timed out.

The sample client accepts a tool suffix (`query`, `action_propose`, etc.) and
JSON input. Set `ACCORD_RETRY_KEY` to preserve a mutation key across retries.
Never use live private inputs in examples, CI logs or public issue reports.

## Projects, tasks, and decisions

The web UI calls workstreams **tasks**, but `workstream.*`, `workstreamId`,
and the `workstreams` state collection retain their existing names and IDs.
The optional planning fields, project commands, human decision responses, and
reminders are specified in [the redesign contract](redesign.md). Generated
OpenAPI schemas include these additions. Agents read scoped project context and
decision feedback through `accord_query`; project membership grants no access.
Legacy creates default to verified completion. Task creation requires the human or a workspace agent with `workstream.create`. Simple completion must be
explicitly requested by the human during creation or policy changes.

## Schema validation

Runtime validators use patched Zod 4. OpenAPI is generated with native
`z.toJSONSchema` in input mode (JSON Schema 2020-12 for OpenAPI 3.1), preserving
optional/defaulted request fields. Existing UUID-like identifiers retain the
8-4-4-4-12 hexadecimal contract through `z.guid()`. All commands still reject
unknown fields; custom domain refinements are enforced at runtime even when
they cannot be represented in JSON Schema. Validation failures retain HTTP 400
and `error.details.formErrors` / `error.details.fieldErrors`.

## People and attention

`GET /api/v1/attention` and MCP `accord_attention` return the authorized current
queue. People command names, scopes, import semantics, and permission boundaries
are documented in [People](people.md). All commands also appear in the generated
OpenAPI document. New archives are `accord.v3`; restore also accepts v1/v2.

## Activity and failed attempts

`GET /api/v1/logs` is owner-only and returns `{ items, nextCursor }`. Parameters:
`actor` (agents, all, or an identity ID), `command`, `outcome`, `q` (search words),
`from` / `to` (inclusive workspace calendar dates), `entity`, `cursor`, and `limit`
(default 50, maximum 100). Pass the returned cursor unchanged. Each item is a
compact summary; `GET /api/v1/logs/{id}` fetches its audit or attempt details.
Responses are no-store. Filters run before keyset pagination. Invalid filters
and cursors return 400; agents cannot access owner diagnostics.

Use `GET /api/v1/state?history=none` or `accord_query` with
`includeHistory: false` for compact current state. The legacy full-history
behavior remains available for existing clients. Authentication and mutation
execution always use compact reads internally.

REST/MCP rejected requests are recorded independently of saved audit changes.
Successful idempotent replays do not duplicate saved changes; each rejected
retry is an observable attempt. No raw request bodies, tokens, retry keys or
provider errors are retained. See [Logs](logs.md) for capture boundaries,
error interpretation, failure fallback, and migration requirements.

## Workspace agent access

Credentials accept `accessMode: "workspace"` for agents only with `assignments: []`. The mode is persisted as `access_mode` in owner credential metadata and returned as `accessMode` on the authenticated actor. Omitted modes retain assigned-record behavior. Workspace access includes future records but never implies additional capabilities or People access. See [agent permissions](agent-guide.md#permissions-three-separate-checks) for management capabilities and protected actions. Archive export and Logs remain owner-only.
