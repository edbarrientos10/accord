# Validation and pilot acceptance

## MIT preview preparation

The source preview was validated on 2026-11-04 with 119 unit/database/API/MCP
tests and 111 browser tests passing, with one intentional mobile skip for a
desktop-only scenario. Formatting, documentation freshness, TypeScript, schema
consistency, production build and dependency audit passed. A clean source snapshot
completed a locked dependency install and rendered the credential-free fictional demo.

The disposable installation check runs real local Supabase on a Docker-enabled
GitHub Actions runner with fictional credentials. It verifies owner bootstrap/login,
public signup denial, REST task creation, generic MCP proposal and human approval,
private evidence access and token revocation. Backup and restore into a separately
bootstrapped destination verify records, audit retention, evidence checksums, old
credential exclusion and fresh credential authentication. Both installations are removed.

See [public CI runs](https://github.com/edbarrientos10/accord/actions) for results on
specific commits. These checks do not establish managed Supabase, SMTP, TOTP or
production readiness.

## Local evidence

Redesign, People, Logs, and documentation validation on 2026-10-26: **85 domain/database/API/auth/storage/MCP/documentation
checks and 50 desktop/mobile browser checks passed**, along with TypeScript,
source formatting, and the optimized production build. These are local checks
with fictional fixtures; they do not imply hosted release acceptance.

Documentation checks cover public Help without authentication or private API reads,
keyboard navigation, mobile layouts, automated accessibility, local links and anchors,
all REST routes and command roles, schema-valid fictional examples, and generated-file
freshness. Help screenshots were visually inspected on desktop and mobile.

The dependency audit now reports **zero known vulnerabilities**, including
production and development dependencies. Zod was upgraded to **4.6.7** to fix
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
All resolved Zod consumers, including the MCP SDK, use the patched version;
no advisory is suppressed. The existing CI dependency-audit command passes.

Zod migration checks verify early rejection of oversized constrained arrays
before element traversal, legacy UUID-like identifiers, request defaults and
strict fields, custom domain refinements, OpenAPI input schemas, MCP tool
schemas over HTTP, and the existing validation-error envelope. OpenAPI uses
Zod 4's native JSON Schema exporter in input mode so defaulted fields remain
optional for clients.

- TypeScript and optimized Next.js production build are checked independently.
- Domain tests exercise assistance, bounded approvals, recurring incidents,
  partial results, evidence-based closure, uncertainty and stale versions.
- Actual PostgreSQL migrations run in PGlite: foreign keys, transactional
  rollback, revision compare-and-swap, idempotency, owner read isolation,
  denied client writes, credential issuance/revocation, and immutable audit.
- A generic SDK client connects over actual stateless MCP HTTP transport,
  queries, proposes, requests approval, receives domain errors and observes
  token rejection. Its HTTP authentication fixture is fictional; separate
  authentication tests exercise the production credential validator with
  controlled Supabase responses.
- Desktop and mobile browser tests render the real application and use
  fictional API fixtures backed by the shared domain service. They cover
  creation, blockers, exact-content approvals, explicit human closure and
  horizontal overflow. They do not prove hosted Auth, Storage, or SMTP.
- The populated v1 upgrade fixture includes existing task IDs, versions,
  assignments, source references, exact proposals, grants, executions, evidence,
  and audit history. It verifies preservation and continued verified-completion
  requirements after the additive migration.
- Redesign checks cover project isolation, simple/verified completion, human-only
  requirement changes, approval feedback and superseded revisions, reminder
  expiry/material invalidation, stale versions, idempotency, and v1/v2 archives.
- Browser journeys cover desktop and mobile creation, assignment, URL filters,
  list/board status menus, exact-content approval, revision feedback/decline,
  snoozing, blockers, both completion modes, long content, empty filters, failed
  saves, recovery, keyboard focus restoration, and the read-only preview.
- Navigation regression checks retain the same application shell and loaded
  snapshot across every menu section and browser Back/Forward on desktop and
  mobile. Explicit refresh still reloads data without replacing the shell.
- Automated axe checks found no WCAG A/AA violations on the core screens,
  sign-in/recovery, and the long-content task panel. This is not a substitute
  for a complete assistive-technology audit. Reduced-motion rendering and
  horizontal overflow are checked. Screenshots are generated in `test-results/`
  and visually reviewed for desktop and mobile layouts.
- The dependency audit is part of CI. The lockfile fixes the tested versions.
  Browser tests use an isolated local server on port 3101 (override with
  `ACCORD_TEST_PORT`), leaving other development servers untouched.

## Hosted release gates

Record the exact Supabase project, Vercel team/project, commit and deployment in
a private pilot record. Do not store credentials, live download/authentication
URLs or private evidence in this repository.

| Gate               | Required evidence                                                     | Initial status |
| ------------------ | --------------------------------------------------------------------- | -------------- |
| Owner setup        | Explicit bootstrap, public signup denied, foreign account denied      | Pending        |
| Authentication     | Login, logout, recovery email, TOTP enrollment and AAL enforcement    | Pending        |
| Database boundary  | Hosted RLS isolation and denied direct mutations/RPC access           | Pending        |
| Storage            | Private upload/download, unauthorized access denied, checksums intact | Pending        |
| Client parity      | Web, REST and generic MCP enforce the same restrictions               | Pending        |
| Revocation         | Connected MCP client loses access after token revocation              | Pending        |
| Concurrency        | Two authenticated clients cannot overwrite each other's decisions     | Pending        |
| Recovery           | Isolated hosted restore includes records, audit and private evidence  | Pending        |
| Fresh installation | A different person installs and completes the basic MCP workflow      | Pending        |
| Usefulness         | Owner confirms attention, authority and real-work status are clearer  | Pending        |

## Scenarios A–F

A: prepare a fictional contract with assistance, hand the next action to the
human, record negotiation/acceptance, and close only with evidence or explicit
attributable confirmation.

B: propose an exact fictional message, request and grant approval, reserve
authority, use a controlled provider double, report delivery separately from
verification, and keep the outcome waiting for acceptance. Changed content
must invalidate the old revision's authority.

C: register an externally scheduled report, grant bounded permission, report
normal and failed executions, verify delivery separately, and confirm repeated
reports of the same incident retain one resolution workstream.

D: develop a fictional project with partial deliveries and ownership changes.
An implementation milestone can be accepted while the overall outcome stays
open for validation or deployment. Preserve history through handoffs/restarts.

E: have two agents update the same version; one must receive a conflict. A
controlled provider timeout stays uncertain and cannot trigger another attempt
until accepted lookup evidence reconciles it. One-time authority is not renewed
automatically.

F: a different person installs Accord with fictional examples and a generic MCP
client, then queries, proposes, obtains human approval and submits evidence.
Record installation problems rather than treating documented steps as proof.

## Pilot observations

Record attention-identification difficulty, missing next actions/owners/criteria,
stale reports, conflicts, ambiguous approvals, prevented false closures,
maintenance effort, recovery, and mobile clarity. Establish a baseline before
claiming improvements. Use the UI review dates and explicit material-event
updates; do not add passive chat collection to obtain metrics.

## People module validation

The People extension adds real populated-migration and RLS checks, independent
People credential tests, REST/MCP attention parity, legacy/v3 archive restoration,
required-commitment completion gates, attributable transitions, and field-preserving
PATCH regressions. Calendar cases cover unknown birth years, leap years, year
rollover, timezone boundaries, distinct advance/day-of acknowledgments, cadence
inheritance/correction and snooze expiry. Import coverage includes CSV quoting,
vCard folding, duplicate candidates, conflicts, invalid input and retry behavior,
including a lost response after a successful server commit.

Browser journeys cover creation, profile panels, interaction logging, important
dates, both commitment workflow controls, reviewed imports, keyboard focus,
accessibility, filters, narrow layouts, and persistent navigation through People.
Fictional preview screenshots cover Directory, contact profiles, Commitments,
Upcoming and Today in both viewport sizes. Local results do not establish hosted
Supabase or deployment acceptance.

## Activity log validation

Logs now uses the additive activity-log migration for indexed summaries and
independent unsuccessful request records. The 20,000-event database check confirms
an unchanged compact snapshot size, bounded pages, stable cursors after new
inserts, and an indexed ordered query plan. It also checks owner RLS, append-only
records, preserved legacy audit, and delta-only command commits.

REST/MCP tests cover SDK input rejection, permissions, malformed requests,
service failures, expired/revoked credential attribution, bounded body reading,
safe metadata and actor-scoped retry references. Successful retries still avoid
duplicate audit events. Desktop/mobile tests inspect rejected attempts, cap the
rendered list at 50 rows, fetch details only on selection, and confirm log
refreshes never reload workspace state. All 46 browser checks passed, including
keyboard, accessibility, error and navigation checks. Screenshots were visually
inspected. These checks do not measure hosted throughput.

## Today dismissal validation

Desktop and mobile browser checks cover dismissing a task with linked reminders,
refresh persistence, task reopening, cancellation of optional commitments, human
waiver of required commitments, pausing contact cadence and disabling important
dates. Domain regressions verify that dismissed/cancelled tasks cannot re-enter
Today through linked commitments, that closing the task preserves those commitments’
states, and that reopening restores their queue eligibility. These are local checks;
hosted behavior still requires the separate deployment and acceptance gates above.
