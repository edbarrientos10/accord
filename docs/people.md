# People, relationships and commitments

People is a private relationship manager. Contacts have no login. Directory,
Commitments and Upcoming views use URL-backed filters; contact panels have
full-page routes. Contacts may belong to one relationship group and have tags,
labeled contact details, notes, source identifiers and important dates.

Groups initially use Family 30 days, Friends 60, Professional 90, and Other off.
A contact inherits its group cadence, overrides it, or pauses reminders. Only
non-voided meaningful interactions affect last-contact timing. Logging and
correcting interactions retains the actor, timestamp and original audit history.
Archiving pauses contact/date reminders, but unresolved commitments remain visible.

## Commitments and completion

Waiting on them and I owe them share one ledger. Requested is distinct from
Committed; Reported done is distinct from Fulfilled. Humans and permitted agents
may record fulfillment with an attributable note. Terminal states can be reopened
as Requested or Committed. Cancelling/declining required work does not satisfy it:
the human must waive it or it must be fulfilled. Only the human can change whether
work is required for task completion or waive it. Reopening a required commitment
on a completed task requires reopening the task first.

Links are informational by default. Neither fulfillment nor a reported result
completes a task, verifies evidence, sends a message or launches an agent runtime.
Task completion retains its existing policy and all execution/conflict checks.

## Dates and attention

The workspace timezone defaults to America/Monterrey and is editable in Settings.
Birth years are optional. Birthdays recur annually, with a day-of reminder and
optional separate seven-day advance notice. February 29 is observed February 28
in non-leap years. One-time dates require a year.

Reminders are projections, not generated tasks. Advance reminders expire at the
start of the event day; day-of reminders expire at its end. Responses identify
an event/year/phase, so acknowledging advance notice never acknowledges the day
itself. Snoozes are tied to the subject revision and occurrence. Cadence or
qualifying-contact changes invalidate outdated stay-in-touch snoozes.

Today includes People filtering. Commitments with several due reasons appear
once. Linked commitments join the task entry; standalone commitments get their
own entry. Completed, cancelled and dismissed tasks and their linked commitment
reminders are excluded from Today; closing a task preserves the commitments’ own
states and history in People. Reopening the task makes any still-due linked
commitments eligible for Today again. Failures and decisions retain higher priority. GET /api/v1/attention
and accord_attention expose the same authorized projection. No scheduler,
notification service or external messaging integration is included.

## Dismiss from Today

**Dismiss** means the work is no longer needed. Confirm the dialog with a reason:

- An optional commitment closes as **Cancelled**.
- A required commitment becomes **Waived**, releasing its task-completion requirement.
  Only the human may waive it; the dialog explains the consequence before confirmation.
- A stay-in-touch reminder sets the person’s cadence to **Paused**.
- An important-date reminder disables the date, including future occurrences.

These changes survive refresh and retain the underlying history. Reopen commitments
as Requested or Committed to pursue them again. Restore contact cadence or enable an
important date in the person’s profile to resume those reminders. If a required
commitment belongs to a completed task, reopen the task before reopening the commitment.

Use **Snooze reminder** for a temporary postponement. **Acknowledge** on an occasion
applies only to its current occurrence; **Dismiss** disables the date itself.

## Agent contract

Existing credentials gain no People access. The human explicitly issues
people.read plus the individual commands needed:

- person.create, person.update, person.import
- relationship_group.create, relationship_group.update
- interaction.log, interaction.correct
- important_date.create, important_date.update
- commitment.create, commitment.update, commitment.transition
- people_reminder.respond

People-only credentials can have empty assignments. Task capabilities require assignments in assigned mode; workspace agent tokens cover current and future work records without assignments, and directory permissions never grant task access.
Mutations require their scope and people.read. The workspace.timezone command
remains human-only. Actor identity always comes from authentication.

People queries return directory context and commitments, but strip inaccessible
task/project links. Task-only credentials receive referenced identity names,
not profiles, birthdays or relationship history. The same rules cover command
results, audit reads and idempotent replays. New links require task/project access.
REST commands and MCP tools share the same validators and transitions.

## Contact import

Import accepts UTF-8 CSV (with explicit column mapping) and vCard 3.0/4.0, up to
2 MiB and 1,000 contacts. CSV birthdays use YYYY-MM-DD or MM-DD; vCard partial
birthdays such as --0229 are supported. Unsupported properties are reported;
photos, attachments and unsupported legacy encodings are omitted. Raw files are
not stored or sent to an external service.

Preview suggests duplicates by email, phone, imported source ID or name. Nothing
is automatically merged. Review each row as Create, Update or Skip and explicitly
resolve conflicting fields. Empty imported values do not erase existing data.
Each contact and its optional birthday commit atomically through person.import.
Rows use stable retry keys; successful rows are retained across retries. A stale
version must be refreshed and reviewed. Requests remain bounded by the existing
256 KB command limit; oversized individual rows fail with an actionable message.

## Migration and recovery

1. Back up the installed workspace and test restoration in an isolated database.
2. Apply existing migrations in order, followed by
   supabase/migrations/202610260002_people.sql. This follows the project redesign
   migration; do not replace either migration with a fresh schema.
3. The migration preserves all existing task/history IDs and third-party identity
   references. Each third party receives a minimal Other profile. New workspaces
   receive the four default groups automatically.
4. Start the matching application build. Verify People reads, a new contact,
   contact update, required commitment, birthday and owner RLS in staging.
5. Issue new explicitly scoped People credentials if needed. Verify task-only
   clients cannot read People details, then exercise People-only REST/MCP reads.

Archives now use accord.v3. Importers retain accord.v1 and accord.v2 support,
populating legacy People defaults. Full CLI backups include the directory and
relationship history. Task-scoped exports include linked commitments and minimal
contact identities, excluding unrelated profile details and interactions.
Credentials are never exported. Restoration requires an empty installation,
remaps the human owner, and preserves evidence checksums and historical IDs.

Hosted migration and deployment remain separate from local implementation.
