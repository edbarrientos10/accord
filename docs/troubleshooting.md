# Troubleshooting Accord

Start with the exact error, the relevant record, and the time. Logs can distinguish
saved changes from failed attempts. Do not share passwords, bearer tokens, recovery
links, signed download URLs, or raw private inputs in a support request.

## Cannot sign in

| Symptom                                          | What to check                                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fictional preview banner                         | Set `ACCORD_DEMO=false` for the installed app and redeploy. The preview cannot save real work.                                                          |
| Supabase is not configured                       | Both public Supabase URL and anonymous key must be available at build time. Configure them and rebuild.                                                 |
| Invalid login credentials                        | Check the selected Supabase project and user email/password. Use password recovery; do not send the password to an agent.                               |
| Email not confirmed                              | Inspect the account's confirmation state in Supabase Auth. Follow the administrator's account setup process.                                            |
| This account is not an installed workspace owner | Supabase Auth exists, but the Accord workspace/identity mapping is missing or belongs to another user. Follow the existing-user installation procedure. |
| Owner identity is missing                        | Have the administrator inspect the workspace/identity mapping. Do not create duplicate owners or loosen RLS.                                            |
| Session is invalid or expired                    | Sign out, refresh, and sign in again. Check the configured project if it persists.                                                                      |
| Complete two-factor verification                 | Enter a current authenticator code for the enrolled account. Recovery must respect MFA.                                                                 |
| Request origin is not allowed                    | `ACCORD_ORIGIN` must exactly match the URL you use, including scheme and any port, with no path or trailing slash.                                      |

Required runtime configuration is `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ACCORD_ORIGIN`, and
`ACCORD_DEMO=false`. Keep the service-role key server-only. Changes to public build
variables require a new build/deployment. See [installation](install.md).

## Password recovery does not arrive or opens the wrong site

Check the spam folder, the email entered, Supabase SMTP, Site URL, and the allowed
`/reset-password` redirect for the exact deployment. The UI deliberately does not confirm
whether an account exists. Local Supabase configuration does not configure hosted Auth.
Never post a live recovery link in a public issue.

## The agent sees no tasks or cannot update a record

Check that the identity is assigned to the task/routine, the token lists that exact
record, and the token has `read` and each necessary mutation scope. Assigning a record
after token issuance does not add it to that token. The owner must issue a replacement
credential and revoke the obsolete one. Project membership does not grant sibling access.

A People-only credential can legitimately have no tasks. A task-only credential cannot
read contact notes or birthdays. `people.read` does not grant linked task access. Ordinary
agent credentials cannot receive human-only authority or `evidence.verify`.

## A command says to reload

Someone changed the record after the form or agent read it. Refresh, inspect the latest
values, and reapply only the change still intended. Agents should use the new version
and a new key for revised input. A timeout retry of unchanged input must keep its original
key and payload. See [agent retry protocol](agent-guide.md#retry-protocol).

## Task cannot be marked done

Inspect these conditions before retrying:

1. Resolve the blocker and record what changed.
2. Reconcile running or uncertain executions using accepted evidence.
3. Resolve conflicting external references.
4. Fulfill or human-waive every required commitment. Declined/cancelled is not enough.
5. For verified completion, cover each criterion with accepted evidence or have the human explicitly confirm completion.
6. For simple completion by an agent, confirm it owns the task and remains assigned.

Only the human can reopen a terminal task or change its completion requirements.
Returning review with feedback is different from editing acceptance criteria.

## Approval exists but execution is rejected

Inspect the current proposal revision, grantee, target, operation, expiry, revocation,
usage count, currency, and cost limit. A grant for another identity cannot be borrowed.
A superseded revision cannot execute. Running/uncertain work can prevent another attempt.
An approval records permission; it does not execute external work. Never “fix” a denial
by pretending a different actor performed it.

## People reminders look unexpected

Check Settings' workspace timezone, contact status, group cadence, person override,
meaningful/non-voided interaction history, and any active snooze. Profile edits and
commitment updates do not count as contact. New-contact timing starts at creation until
a qualifying interaction exists.

Advance and day-of occasions are separate. Acknowledging advance does not suppress
the birthday itself. February 29 becomes February 28 in non-leap years. Archived contacts
stop relationship reminders, but their unresolved commitments remain visible. Today
combines linked commitments into the task item, so inspect that task's reasons.

If an item disappeared after **Dismiss**, check its underlying record: a task is
Dismissed, an optional commitment is Cancelled, a required commitment is Waived,
a contact cadence is Paused, or an important date is disabled. These changes persist
after refresh. Reopen the work or re-enable cadence/date reminders to restore it;
**Bring back now** applies to snoozes. Closing a task also excludes its linked
commitment reminders from Today without closing those commitments in People.

## Contact import partially succeeded

Keep the preview open while reviewing results. Successful rows remain identifiable and
safe to retry with their original keys. Refresh and review stale rows; do not replay
changed fields under a successful row's key. Resolve duplicates/conflicts explicitly.
Names alone are suggestions, not permission to merge. Unsupported properties and photos
are not imported. Check UTF-8 encoding, the 2 MiB limit, and the 1,000-contact limit.

## Evidence upload or download fails

Uploads require appropriate record access, the current parent version, an idempotency
key, and a file of at most 3 MiB. Let the client create the multipart boundary. Upload
through the authenticated endpoint rather than passing a storage path to a command.
A download URL expires after 60 seconds; request a new one. Check private Storage and
migration configuration if failures persist. A failed or interrupted upload can leave
an unregistered private object; administrators should follow the recovery procedure.

## A failed attempt is missing from Logs

Select Everyone or the correct actor, check outcome/date/search filters, and return to
Newest activity. Dates use the workspace timezone. Saved changes, reported execution
failures, rejected requests, and service failures are different outcomes.

Unknown credentials cannot be attributed, successful reads are not captured, and actions
outside Accord are not observable. A log-storage outage can prevent capture. The original
request error remains primary; REST may include `X-Accord-Log-Status` and MCP
`_meta["accord/logStatus"]`. Administrators can inspect sanitized server diagnostics.
Logical archives do not include failed-attempt diagnostics. See [Logs](logs.md).

## Workspace unavailable after deployment

Check that the deployment uses the intended Supabase project, all repository migrations
are applied in order, the owner is installed, the service key is valid, and the app is
not in preview mode. Do not reset a populated database to solve a missing migration.
Use `supabase db push --dry-run` to inspect pending migrations against the explicitly
selected project. Hosted deployment, Auth, RLS, Storage, and recovery need their own checks.

## Request help with useful evidence

Provide the app version/commit if known, deployment origin, screen, safe record ID,
command name, error code, approximate time/timezone, and whether it happened once or on
an unchanged retry. For MCP include whether connection, tool discovery, or tool invocation
failed. Include sanitized Logs details. Preserve private records and secrets outside
public tickets. Read [recovery](recovery.md) before any restore or rollback.
