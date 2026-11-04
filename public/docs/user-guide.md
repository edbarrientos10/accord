# Using Accord

Accord helps you see what needs you, who is coordinating each task, what was approved,
and what evidence establishes completion. Projects organize tasks. People records
relationships and commitments. Agents act through explicitly scoped credentials.

## First sign-in

Open your installed Accord URL and sign in with the workspace owner's email and
password. If two-factor authentication is enabled, enter your authenticator code.
Use **Recover password** after entering your email to request a recovery link.

A Supabase Auth user must also be linked to an Accord workspace and human identity.
Creating a user in the Supabase dashboard alone does not finish installation. An
administrator should follow [owner installation](install.md#owner-installation),
including its existing-user procedure when appropriate.

A **Fictional, read-only preview** banner means you are exploring demo data. You can
open screens, but changes and real sign-in are unavailable in that mode. Your deployed
workspace needs `ACCORD_DEMO=false`. See [troubleshooting](troubleshooting.md).

## A first task in five minutes

1. Open **Projects**, choose **New project**, and enter a name, such as “Autumn event.” Description and target date are optional.
2. Open the project and choose **New task**. Enter “Confirm the venue.” A title is enough; it becomes the initial description if you leave that blank.
3. Leave yourself as owner and **Simple** as completion, or choose another existing owner. Set priority and due date if useful.
4. Open the task and write the next step, such as “Ask the venue to confirm availability.” Assign a next-step owner.
5. When the work is finished, choose **Mark done**. If Accord refuses, inspect blockers, outstanding executions, source conflicts, and required commitments.

Use **Verified** completion when you need explicit acceptance criteria and accepted
evidence or a human completion confirmation. The completion mode is recorded in history.

## Navigation and everyday use

| Screen   | Use it for                                                 |
| -------- | ---------------------------------------------------------- |
| Today    | Approvals, completion reviews, problems, and due reminders |
| Tasks    | All tasks, list/board views, search, and filters           |
| Projects | Grouping tasks and reviewing progress                      |
| People   | Contacts, interactions, commitments, and important dates   |
| Routines | Observing work scheduled outside Accord                    |
| Agents   | Identities, scoped credentials, and links to activity      |
| Logs     | Saved changes, reported results, and unsuccessful requests |
| Settings | Workspace timezone, selected exports, and two-factor setup |

**New task** is also available in the sidebar. **Find a task** opens Tasks with search
focused. Use **Refresh workspace** to fetch the latest saved state. On mobile, open the
navigation menu from the top bar. Use **Sign out** when leaving a shared device.

Filters and selected task/contact panels are stored in the URL. You can bookmark them;
the recipient still needs access. Panels include a full-page link. Escape closes task
and contact dialogs, and focus returns to the control that opened them. Tab and
Shift+Tab move through controls; buttons and menus provide alternatives to dragging cards.

## Today: work through decisions

Today opens with **Needs me**: approvals, completion reviews, your next actions,
and blockers assigned to you. The summary and sidebar badge count only unsnoozed
items in this personal queue. A task's overall owner does not override a next step
or blocker assigned to an agent.

Use **Agent work** for queued follow-ups and blockers assigned to agents or
integrations. **Monitoring** contains routine health alerts, execution problems
without a human handoff, external waiting, and reminder-only check-ins. A due date
or automatic review reminder does not by itself hand agent work back to you.
**All** combines the three queues. Approvals, Reviews, Blockers, Follow-ups, and
People refine Needs me; **Snoozed** shows postponed items from every queue.

Priority and age order items within groups. A task follow-up combines its reasons;
separate proposals remain independently actionable. A linked People reminder
coordinated by you can bring an agent's task into Needs me. Select a row to see
its context, responsible identity, evidence, and available actions. On mobile,
return to the queue using **Back to queue**.

### Approve or return a proposal

1. Select an approval item and read **Exact content**, revision, operation, target, scope, declared cost, and expiry.
2. Choose **Review & approve** and select who may execute it. Approval applies to this revision and scope only.
3. If the content needs work, choose **Request changes** and explain the revision needed. Use **Decline** with feedback to reject the proposal.
4. The current request closes when declined or returned. The agent must create a new proposal revision before requesting approval again.

Approval records permission. It does not perform the action. A revoked or expired
permission, exhausted usage allowance, or changed proposal can prevent execution.

### Review completion and blockers

For a completion review, inspect the criteria and evidence, then choose **Accept
completion** or **Request changes**. Returning work records feedback and puts it back
in progress. For a blocker, read what was tried and the condition needed to resume.
Choose **Resolve blocker** only when that condition is satisfied and record why.

An uncertain external attempt needs evidence and reconciliation. Do not repeat an
external action just to make the warning disappear. Open the full task or routine to
inspect its execution records and supporting evidence.

### Dismiss work you no longer need

Choose **Dismiss** when you no longer want to pursue an item. Review the dialog,
record a reason, and confirm. Dismissal changes the underlying record and persists
after refresh; use **Snooze** when you intend to return to the same work later.

| Item                                          | What Dismiss does                                                                                                      | How to restore it                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Task follow-up, completion review, or blocker | Closes the task as **Dismissed**, records the reason, and removes its linked People reminders from Today.              | Open the task and choose **Reopen task**.                                              |
| Optional People commitment                    | Closes the commitment as **Cancelled** and stops its reminders.                                                        | Use **Update state** to reopen it as Requested or Committed.                           |
| Required People commitment                    | **Waives** the commitment, so it no longer blocks completion of the linked task. The dialog explains this consequence. | Reopen the commitment as Requested or Committed; reopen a completed linked task first. |
| Stay-in-touch reminder                        | Pauses that person’s contact cadence.                                                                                  | Enable the cadence again in their profile.                                             |
| Important-date reminder                       | Disables the date, including its future reminders.                                                                     | Enable the date again in the person’s profile.                                         |

Dismissed records retain their history. Dismissing a task does not mark its linked
commitments fulfilled or cancelled; their records remain available in People.
Dismissing a commitment does not complete its linked task. Approval proposals use
**Decline**; routine items retain their existing review and snooze actions.

### Snooze without changing the work

**Snooze** postpones a reminder until a chosen time. It does not change the task's due
date, status, grant expiry, or authority. Inspect snoozed work in the **Snoozed** filter;
task/routine reminders offer **Bring back now**. Material changes can bring an item
back before its snooze expires. People occasion responses apply to one occurrence.

Today shows reminders in the app. It does not deliver email, push notifications, or
messages. Time-based views update while the app is open; refresh to fetch other actors'
latest changes.

## Tasks: ownership, progress, and completion

Use the list for scanning or switch to the board. Combine search with status, project,
owner, and priority filters. Priorities are None, Low, Medium, High, and Urgent. A due
date is a calendar deadline; a review reminder is a separate time to revisit the task.

Task stages are **To do**, **In progress**, **Blocked**, **In review**, and **Done**.
Cancelled and dismissed tasks remain distinct historical dispositions. Changing stage
uses the same rules as other task commands: dragging into Done cannot bypass closure
checks, and moving out of Blocked requires a resolution. Reopening completed,
cancelled, or dismissed work is a human action with a reason.

### Edit the task

Open a row or card. Title, status, owner, project, priority, due date, and next step are
near the top. The task's owner is accountable for the whole task; the next-step owner
may be different. An agent owner is added to the task's agent assignments, and, with a Selected records token, still
needs a credential covering that task.

- **Overview** holds outcome, Links, next step, criteria, collaboration context, external references, and linked commitments.
- **Decisions** holds proposals, grants, execution reports, and decision feedback.
- **Evidence** holds links or private uploads and their acceptance state.
- **Activity** shows a bounded history with access to the full Logs inspector.

Use **More task actions** for collaboration details, completion requirements, standing
permissions, cancel/dismiss, and reopening. Collaboration modes describe how you intend
to work; they do not replace grants or authorize an external action by themselves.
Workspace agents with workstream.update and workstream.manage may change task ownership, assignments, and project. Only the human changes the outcome or acceptance requirements.

### Task links

Use **Links → Add link** below Description to save a document, deliverable, or useful
resource. Enter a title, an HTTP/HTTPS URL, and an optional note. Open the title to
visit the resource. **Edit** keeps the link's identity; **Remove** removes it from
the current list while preserving the change in task history. Links are visible in
both the task panel and full-page view. Closed tasks keep their links read-only.

Authorized agents with `workstream.update` can add, edit, and remove links. API/MCP
updates replace the complete `links` list, so an agent adding a link must include
the existing entries. Omitting `links` preserves them; `links: []` clears the list.
Links save URLs and text without uploading files or fetching previews. Use Evidence
when a resource establishes an acceptance criterion, and External references when
tracking another system's object and status.

### Simple versus verified completion

| Policy   | How completion works                                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Simple   | The human, assigned agent who owns the task, or a workspace agent with workstream.close can mark it done. No independent evidence verification is implied.         |
| Verified | An authorized agent needs accepted or independently verified evidence for every criterion. The human may use that evidence or an explicit completion confirmation. |

Both policies refuse closure with an unresolved blocker, running/uncertain execution,
external source conflict, or an unfulfilled required commitment. A required commitment
must be Fulfilled or human-Waived; cancelling or declining it is insufficient.

For verified work, attach evidence with provenance and the criteria it establishes.
A report or attachment starts unverified. The human can accept it; an explicitly scoped
independent integration can verify it. Agents cannot verify their own or other agents'
evidence. Private uploads are limited to 3 MiB; use a suitable private source link for
larger material. Download links are short-lived and should not be shared as permanent URLs.

External references record a system, object ID, URL, responsibility, reported status,
and check time. Resolve an actual discrepancy before clearing a source conflict.
Accord does not automatically synchronize those systems.

## Projects

Create projects with a name and optional description and target date. Open a project
for its task list or board. Progress is derived from its tasks. Tasks may also exist
without a project.

Use **Edit project** to archive or reactivate a project. Archiving changes organization;
it does not complete tasks or hide unresolved work from Today. The Projects screen has
an Archived view. An agent's access to one project task gives it relevant project
context, not access to every sibling task.

## People: contacts and relationships

Open **People** and choose **New person**. Only the name is required. Add organization,
role, one relationship group, tags, notes, and labeled email/phone/link fields as needed.
In multiline contact fields, use one entry per line, such as `Work: alex@example.com`.
Contacts do not get accounts, credentials, notifications, or task ownership.

Use **Directory**, **Commitments**, and **Upcoming** with the available search and
filters. A profile opens as a panel and can be opened full page. The directory also
lets you edit relationship groups and their stay-in-touch cadences.

### Stay in touch and interaction history

Initial group cadences are Family 30 days, Friends 60 days, Professional 90 days, and
Other off. New contacts start in Other. A person can inherit the group cadence, use a
custom cadence, or pause it. Without an interaction, timing starts at contact creation.

Choose **Log interaction**, record when and how it happened, a summary, and an optional
source reference. Mark whether it was meaningful. Only meaningful, non-voided interactions
reset stay-in-touch timing. Editing a profile or updating a commitment does not.
Correct an inaccurate interaction or void it; the history remains attributable.
Snoozing a contact reminder does not invent a conversation.

Archiving a contact pauses relationship and occasion reminders. Unresolved commitments
remain visible, and historical links remain intact.

### Commitments in either direction

Choose **Add commitment** from a profile, a task's People section, or the Commitments
view. Select **Waiting on them** or **I owe them**, the requested outcome, and a human
or agent coordinator. Optionally add a promised date, next follow-up time, priority,
source reference, and task/project links.

| State         | Meaning                                                       |
| ------------- | ------------------------------------------------------------- |
| Requested     | A request was recorded; agreement is not implied.             |
| Committed     | The commitment has been agreed.                               |
| Reported done | Completion has been reported and needs confirmation.          |
| Fulfilled     | You or an authorized agent confirmed the outcome with a note. |
| Declined      | The request was declined.                                     |
| Cancelled     | The commitment was cancelled.                                 |
| Waived        | The human explicitly released the requirement with a reason.  |

Use **Update state** and record what establishes the change. Reopening terminal work
as Requested or Committed retains history. If required work belongs to a completed
task, reopen that task before reopening the commitment.

Task links are informational by default. The human may set **Required for task
completion**. Only the human can change that requirement or waive it. Fulfillment never
completes the task automatically and never verifies evidence. Recording a commitment
or interaction sends no message to the contact.

### Birthdays and other dates

Add birthdays, anniversaries, or named dates in a person's **Important dates** section.
Annual dates may omit the year; do not guess a birth year or age. One-time dates need a
year. Birthdays recur annually and always have a day-of reminder. A separate seven-day
advance reminder is optional and off by default.

Acknowledging the advance reminder does not acknowledge the day itself. Advance
reminders expire when the event day starts; day-of reminders expire at day end in the
workspace timezone. February 29 is observed February 28 in non-leap years. Reminders
are computed from records; Accord does not create annual task copies.

### Import contacts

1. Choose **Import contacts** and select UTF-8 CSV or vCard 3.0/4.0, at most 2 MiB and 1,000 contacts.
2. For CSV, map the columns. Birthdays accept `YYYY-MM-DD` or `MM-DD`.
3. Review validation messages and duplicate candidates. Choose Create, Update, or Skip for each row; a matching name alone does not merge contacts.
4. Resolve conflicting existing fields explicitly. Empty import fields do not erase saved values.
5. Commit the reviewed rows. Successful rows remain identifiable on retry. Reload and review stale rows before trying again.

Imports cover profiles and birthdays, not interaction or commitment history. Unsupported
properties are surfaced; photos/attachments are omitted. Raw files are not retained.
See [People](people.md) for detailed import and reminder semantics.

## Connect and supervise an agent

1. In **Agents**, choose **Add identity** and create an Agent identity.
2. For Selected records access, assign it to a task or routine using that record's collaboration settings. Entire workspace access skips this step.
3. Choose **Issue token**, select the identity, capabilities, access mode, and expiry. Select exact assigned records when using Selected records access.
4. Save the token immediately in the agent runtime's secret storage; Accord shows it once. Give the agent your deployment's `/mcp` URL or REST base URL and the [agent guide](agent-guide.md).
5. Ask the agent to query its assignments. Assignment records work; it does not launch the agent.

For ordinary task work, include `read` and only the mutation scopes needed. Both the
record's agent assignments and the token's assignments must allow the task when using Selected records access. Existing
assigned-record tokens do not automatically acquire new tasks; workspace tokens include future records. No token automatically acquires new capabilities. Issue a replacement and revoke the old token when changing its capabilities or access mode.

A People-only token can use `people.read` plus selected People mutation scopes with no
task assignments. This grants directory access but no linked task contents. For such
a token, remove the default `read` scope. A verifier integration uses `read` and
`evidence.verify` with assigned records; it cannot act as an ordinary worker.

**Revoke access** disables a credential. If the one-time token was lost, revoke it and
issue another. Never give an agent the Supabase service-role key or your owner login.
For execution permission, review proposals in Today or grant bounded standing permission
on the record. A credential's API scope and an execution grant are separate requirements.

## Routines

Create a routine with its purpose, coordinator, assigned agents, expected cadence in
hours, and next expected execution. Its scheduler runs elsewhere. A routine records
attempts, evidence, latest reported execution, verified success, and linked incidents.

Grant bounded standing permission before an agent starts an attempt. After doing the
external work, the agent reports succeeded, partial, failed, or uncertain. Failed/partial/
uncertain reports can create linked recovery tasks; a stable incident key prevents
repeated reports from spawning duplicate unresolved incidents. A new report does not
mean the latest execution was verified. Review the evidence and verification separately.

## Logs: understand what happened

Open **Logs** or **View activity** on an identity. The default shows agents and
integrations; select Everyone to include the human. Filter by actor, command, outcome,
related record, calendar date, or search words. Select an entry to inspect its details.

Saved changes contain before/after history. Attempts record validation, permission,
version, lifecycle, and service failures with safe diagnostics. A rejected request did
not grant authority. A reported external failure is different from an Accord request
that was rejected. Successful read-only calls and work outside Accord are not recorded.

Logs load 50 summaries per page with details on demand. The newest page refreshes every
15 seconds while visible; older pages stay stable. Use **Newest activity** to return.
Logs are owner-only. They omit raw request bodies, tokens, raw retry keys, and provider
stack traces. Database outages can prevent capture; inspect server diagnostics if needed.
See [Logs](logs.md) for exact coverage and backup behavior.

## Settings and recovery

Choose **Settings → Appearance → Theme** to use **System (default)**, **Light**, or
**Dark**. System follows your device's appearance, including changes while Accord
is open. Your choice is saved in this browser and shared across its Accord tabs.

Set the calendar timezone in **Settings**; the default is `America/Monterrey`. This
controls calendar dates and reminder projections. Use **Enable TOTP** to enroll an
authenticator, store its secret privately, and verify a six-digit code to finish setup.
Password recovery and SMTP must be configured by the administrator.

**Export selected records** downloads a private archive for selected projects, tasks,
or routines, including relevant evidence. Project selection includes its tasks.
Task exports contain linked commitments and minimal contact identities, not the whole
People directory. Credentials and passwords are excluded. Full backups and restoration
are administrator CLI operations; see [recovery](recovery.md). Logical archives omit
failed-attempt diagnostics, which require a database backup if they must be preserved.

## When something does not work

Keep the exact error text, the page URL without credentials, the record ID, and the
approximate time. Refresh after stale-version errors and review the current state before
retrying. Do not repeatedly approve, execute, or complete work to clear a warning.
Use [troubleshooting](troubleshooting.md) and Logs to distinguish configuration,
authorization, workflow requirements, and external uncertainty.

## Workspace-wide agent credentials

In **Agents → Issue token**, select an agent and choose **Entire workspace** under **Record access**. This includes current and future tasks, routines, and projects without per-record assignment. The record picker is disabled in this mode. Select only the capabilities to delegate; `read` stays the default and management capabilities start unchecked. People directory access requires `people.read` separately.

For full work management, select project create/update, task create/update/reopen/terminate, and routine create/update capabilities. Add `workstream.manage` with `workstream.update` for ownership, assignments, and project organization. Select `workstream.close` to allow completion of simple tasks owned by others; verified completion still requires accepted evidence.

Existing tokens stay on **Selected records**, which requires assigning the agent to each selected task/routine. Workspace-wide access is not available to independent verifier integrations. Revocation and expiration still apply. Owner approvals, execution grants, credentials, and changes to existing task criteria, completion policy, or authority mode stay human-controlled. Credential cards display their access mode. Save the token when it appears; it is shown only once.

## Your profile and logging out

Open **Settings → Your profile**, or select your name in the sidebar, to set your
display name and optional role/title. Save profile updates your name throughout
the workspace. Clear Role/title to remove it. If your workspace still uses the
default owner name, a setup prompt offers a shortcut; **Not now** hides it for
this browser session. Setup is optional.

Choose **Log out** beneath your sidebar account details (also in mobile navigation)
or in **Settings → Account** to end the session on this browser and return to
sign-in. If logout fails, an error appears and you can retry. The fictional
read-only preview has no logout action.
