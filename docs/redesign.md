# Projects, tasks, and decisions

Accord is a personal workspace for one human owner and their agents. The UI
uses task terminology; the existing `workstreams` records, IDs, command names,
and credential assignments remain the compatibility contract.

## Workspace

- **Today** prioritizes uncertain/failed executions and source conflicts,
  approvals and completion reviews, blockers, then due follow-ups. A task has
  one follow-up with all applicable reasons; independent proposals have their
  own decision items. Snoozed items have a separate queue. **Dismiss** closes a
  task as dismissed with a reason; closed tasks and their linked People reminders
  leave Today until reopened. People dismissal cancels optional commitments,
  human-waives required commitments, pauses contact cadence, or disables an
  important date. See the [user guide](user-guide.md#dismiss-work-you-no-longer-need).
- **Tasks** offers lists and boards. Search, status, owner, priority, project,
  view, and selected task are URL parameters. Task panels have full-page links.
- **Projects** group tasks and display completed/total task counts. Archiving a
  project never completes its tasks, revokes permissions, or hides attention.
- **Routines** report externally scheduled operations, attempts, evidence and
  recovery tasks. They do not start an agent scheduler.
- **Agents** manages identities and scoped credentials. Assignment records
  work for API/MCP clients to retrieve; it does not launch a runtime.
- **Settings** holds scoped private exports and two-factor enrollment.

Old `/workstreams`, `/workstreams/:id`, `/operations`, `/operations/:id`,
`/inbox`, and `/overview` links redirect to their new equivalents. The former
Inbox and Overview both become Today.

## Task contract

Optional additions to `Workstream` and its create/update commands:

| Field              | Values/default                                                |
| ------------------ | ------------------------------------------------------------- |
| `projectId`        | Project UUID or null; defaults to no project                  |
| `priority`         | `none`, `low`, `medium`, `high`, `urgent`; defaults to none   |
| `dueDate`          | Calendar date `YYYY-MM-DD` or null; independent of `reviewAt` |
| `planningStage`    | `todo` or `in_progress`; applies when lifecycle is `open`     |
| `completionPolicy` | `simple` or `verified`; legacy create defaults to verified    |

The redesigned task form explicitly selects simple completion by default.
Title-only creation uses the title as the initial desired outcome; users may
edit the description. It uses the human owner unless another owner is chosen.
Choosing an agent owner adds that agent to task assignments, but credentials
need their own explicit assignment in Selected records mode; workspace tokens cover current and future tasks.

Simple tasks can have zero criteria. The human owner or an assigned agent who
owns the task, or a workspace agent with workstream.close, can complete them. Completion records the actor and reason and
does not claim verified evidence. Verified tasks still require criteria and
trusted evidence or explicit human acceptance. Both modes refuse completion
while blocked, with running/uncertain executions, or with conflicting references.
Only the human changes the outcome, completion policy, or criteria. Workspace agents with workstream.update and workstream.manage may change ownership, assignments, or project.

Board controls use the shared lifecycle commands. Moving to Done invokes
completion; moving out of Blocked requires resolution; returning a review
requires feedback; reopening a terminal task requires a human or a workspace agent with workstream.reopen and an attributable reason. Keyboard
and mobile users can use the same transitions through status menus.

## New commands and state

`State` adds `projects`, `decisions`, and `reminders` arrays. All mutations retain
entity-version checks, workspace compare-and-swap, content-bound idempotency,
and attributable audit events.

- `project.create`: name, optional description and target calendar date, reason.
- `project.update`: entityId, expectedVersion, optional name/description/
  targetDate/status (`active` or `archived`), reason.
- `decision.respond`: entityId, expectedVersion, response (`declined` or
  `changes_requested`), nonempty feedback and reason. Proposal responses close
  the request; the next request must use a new immutable proposal revision.
  Completion reviews support only `changes_requested`, returning the task to
  open/in progress. Existing `grant.approve` and `workstream.close` record
  approval/acceptance decisions as part of their transactions.
- `reminder.snooze`: subject entityId (task, proposal, routine), expectedVersion,
  future `until`, reason. Records are unique per subject and human in normal
  command execution. The reminder does not change deadlines or authority.
- `reminder.clear`: reminder entityId, expectedVersion, reason; expires the
  reminder while preserving its history.

All new management commands are human-only. Authorized agents read decision
feedback through `accord_query`. They see project context only for explicitly
accessible tasks, never other tasks merely because they share a project.
Project audit events and personal snoozes are not included in agent views.

A snooze is valid only for its subject version and until its timestamp. New
attempts, evidence, grants or decision feedback on related work expire the
reminder even when the parent's own version did not change. Resolution and
supersession remove the corresponding item from the queue.

## Upgrade and recovery

1. Back up the existing installation with its currently deployed version.
2. Review `202610260001_projects_decisions.sql` against a staging copy. It adds
   three tables, project membership, owner-read RLS, an append-only decision
   trigger, and updated snapshot/commit functions.
3. Apply all repository migrations before starting the redesigned application.
   For a linked managed project, review `supabase db push --dry-run` first;
   applying to a hosted project is a separate authorized release step.
4. Verify legacy IDs, versions, grants, evidence, history, and file paths. Old
   tasks receive verified completion, no project/priority/due date, and To do
   planning stage without changing their lifecycle or historical events.
5. Exercise create, assignment, approval, feedback, snooze, both completion
   modes, exports and agent-scoped reads against the upgraded staging instance.

The redesign introduced `accord.v2`; current People-enabled archives use `accord.v3`.
The importer accepts both `accord.v1` and `accord.v2`, supplying safe legacy defaults. A selected
project export includes its tasks; an individual task export includes project
context without unrelated tasks. Restore still requires an empty installation,
remaps the owner, preserves private evidence checksums, and excludes credentials.

Do not downgrade the application against new simple tasks: the old application
has no simple-completion semantics. Recover with the previous backup into an
isolated installation if rollback is needed. No destructive down migration is
provided. Local PGlite tests validate the upgrade and recovery paths; hosted
Supabase, RLS, Auth, Storage, and SMTP gates remain separate.

## Design implementation

Self-hosted Manrope, IBM Plex Sans, and IBM Plex Mono come from the installed
Fontsource packages; the browser does not contact a font service. The shell,
data provider, command adapters, task views, decisions, routines, identities,
and settings are separate modules. Shared tokens live in `globals.css`.

The fictional preview is read-only in both UI and server routes. It contains
no real accounts or connected services. Browser mutations are validated using
fictional API fixtures backed by the real domain command service.
