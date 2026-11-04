# Backup, export and restore

Backups are private JSON archives containing coordination records, audit
history, evidence bytes and checksums. Agent credentials and authentication
passwords are excluded. Store archives with filesystem permissions restricted
to the owner and use encryption for off-device storage.

## Backup

Configure the source project's private environment, then run `npm run backup`.
The script writes a new file in ignored `backups/` with mode 0600. It downloads
registered evidence and verifies SHA-256; a missing or mismatched file fails the
backup. Database records come from one consistent snapshot. Orphaned uploads
are not part of the archive because no coordination record references them.

Settings provides an explicit, selected-record export, including related
evidence files and linked operation incidents. This is a portable private
archive, not a public sharing feature. Review its scope before downloading.

## Restore exercise

1. Create an isolated destination project and apply the migrations.
2. Configure its private environment and bootstrap its owner. It must contain
   only that owner identity and no workstreams, operations or domain records.
3. Run `npm run restore -- /private/path/accord-backup.json` against the
   destination environment. Never use the source environment for this command.
4. The script validates the archive and all evidence checksums before uploading.
   It maps workspace IDs, object paths and the historical owner identity to the
   new installed owner, records that mapping in history, uploads evidence, and
   commits the restored records atomically.
5. Compare outcomes, versions, audit events, criteria, uncertainty, evidence
   checksums and private download access. Issue fresh scoped agent credentials
   and review standing permissions before reconnecting any runtime.

Restore refuses a nonempty destination and does not replace existing data.
Storage and PostgreSQL cannot commit together. An interrupted upload/commit may
leave private, unregistered destination objects; inspect those against the
archive before retrying. No partial coordination records are committed.

The automated recovery checks exercise archive selection, credential exclusion,
checksum rejection, owner mapping, preserved history, and database atomicity.
An actual managed Supabase Auth/Storage restore still requires an isolated
hosted project. Log that result in the pilot checklist before claiming recovery
has been verified on the deployment.

## Archive version compatibility

New exports use `accord.v3`. The restore validator also accepts `accord.v1` and `accord.v2`,
defaulting old tasks to verified completion and empty project/decision/reminder
collections. Projects, decisions and reminders remain included in backups and
owner remapping. Project exports include their tasks; task exports include only
the necessary project context. Restore rejects missing project/decision/reminder
relationships and nonempty destinations. Apply all migrations before restoring.

People archives use `accord.v3`; the importer still accepts v1/v2. Full backups
include profiles, relationship groups, interactions, important dates, commitments,
occurrence responses and the workspace timezone. Apply the People migration before
restoring v3. See [People migration and recovery](people.md#migration-and-recovery).

The activity-log migration rebuilds saved-change summaries from audit events,
including restored archives. Logical accord archives do not include operational
failed-attempt diagnostics. Use a database backup to preserve those records;
see [Logs recovery](logs.md#migration-and-recovery).
