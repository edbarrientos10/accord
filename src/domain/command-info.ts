import type { CommandName } from './commands';

/** Shared documentation only. Authorization and validation remain in the command service. */
export const commandInfo: Record<CommandName, { summary: string; versionTarget: string }> = {
  'profile.update': {
    summary:
      'Update your display name and optional role/title. Human owner only; empty role clears it.',
    versionTarget: 'workspace.revision',
  },
  'workspace.timezone': {
    summary: 'Set the IANA workspace timezone. Human only.',
    versionTarget: 'workspace.revision',
  },
  'project.create': {
    summary:
      'Create a project with optional description and target date. Does not grant task access.',
    versionTarget: 'none',
  },
  'project.update': {
    summary: 'Edit, archive, or reactivate a project without completing its tasks.',
    versionTarget: 'project',
  },
  'workstream.create': {
    summary:
      'Create a task with optional links (id, title, HTTP/HTTPS url, optional note). Human or explicitly scoped workspace agent; defaults to verified completion. The UI explicitly selects simple completion.',
    versionTarget: 'none',
  },
  'workstream.update': {
    summary:
      'Update task planning, progress, next action, or links. Links replaces the full list: preserve existing entries when adding; omit to keep, [] to clear. Authorized agents can add, edit, and remove links. Workspace agents with workstream.manage may change owner, assignments, or project. Only the human can change outcome, mode, policy, criteria, or clear external conflicts. Preserve existing references.',
    versionTarget: 'task',
  },
  'workstream.block': {
    summary: 'Record a blocker with cause, attempted resolution, unblock condition, and resolver.',
    versionTarget: 'task',
  },
  'workstream.unblock': {
    summary: 'Resolve a blocker with an attributable reason after its condition is satisfied.',
    versionTarget: 'task',
  },
  'workstream.review': {
    summary: 'Submit an unblocked task for completion review.',
    versionTarget: 'task',
  },
  'workstream.close': {
    summary:
      'Complete a task through its policy. Simple requires the human, assigned agent owner, or scoped workspace agent; verified requires trusted criterion evidence or explicit human confirmation. Unresolved blockers, executions, conflicts, and required commitments prevent closure.',
    versionTarget: 'task',
  },
  'workstream.terminate': {
    summary:
      'Cancel or dismiss a task with a reason. Human or scoped workspace agent; preserves the distinct disposition.',
    versionTarget: 'task',
  },
  'workstream.reopen': {
    summary: 'Reopen a completed, cancelled, or dismissed task. Human or scoped workspace agent.',
    versionTarget: 'task',
  },
  'action.propose': {
    summary:
      'Create an immutable exact-content proposal for a task. Use supersedesId for a revision; previous approval does not transfer.',
    versionTarget: 'parent task',
  },
  'action.request_approval': {
    summary: 'Request human approval of the current unexpired proposal revision.',
    versionTarget: 'action',
  },
  'decision.respond': {
    summary:
      'Decline a proposal or request changes with feedback. Human only; creates no authority. Proposal retries require a new revision; returning a completion review reopens active work.',
    versionTarget: 'action or task under review',
  },
  'grant.approve': {
    summary: 'Approve one exact proposal revision for a grantee. Human only; does not execute it.',
    versionTarget: 'action',
  },
  'grant.standing': {
    summary:
      'Grant bounded recurring permission for exactly one task or routine, with operation, target, time, use, and declared-cost limits. Human only.',
    versionTarget: 'parent task or routine',
  },
  'grant.revoke': {
    summary: 'Revoke a grant. Human only; does not undo external effects.',
    versionTarget: 'grant',
  },
  'execution.start': {
    summary:
      'Reserve applicable authority before external work. Choose exactly one action or routine. Requires the actor as grantee and no conflicting running/uncertain attempt. Does not run external tools.',
    versionTarget: 'action or routine',
  },
  'execution.report': {
    summary:
      'Record succeeded, partial, failed, or uncertain observation for a running execution. Executor or human only; report is not independent verification.',
    versionTarget: 'execution',
  },
  'execution.reconcile': {
    summary:
      'Resolve a running/uncertain execution with accepted evidence tied to that attempt. Do not repeat external work to resolve ambiguity.',
    versionTarget: 'execution',
  },
  'evidence.attach': {
    summary:
      'Attach unverified evidence with provenance to exactly one task or routine. Use authenticated file upload for bytes, never raw storagePath claims.',
    versionTarget: 'parent task or routine',
  },
  'evidence.verify': {
    summary:
      'Accept evidence as the human or independently verify as a scoped integration. Ordinary agents cannot verify; integrations cannot verify their own execution.',
    versionTarget: 'evidence',
  },
  'evidence.invalidate': {
    summary: 'Invalidate previously trusted evidence with a reason. Human only.',
    versionTarget: 'evidence',
  },
  'operation.create': {
    summary:
      'Create a routine observed by Accord and scheduled externally. Human or scoped workspace agent.',
    versionTarget: 'none',
  },
  'operation.update': {
    summary:
      'Update routine purpose, cadence, expected time, or assignments. Human or scoped workspace agent; does not change an external scheduler.',
    versionTarget: 'routine',
  },
  'identity.create': {
    summary:
      'Create an agent, integration, or third-party identity. Human only; does not launch a runtime or issue a token.',
    versionTarget: 'none',
  },
  'reminder.snooze': {
    summary:
      'Postpone a task, action, or routine reminder for its current version. Human only; changes neither status nor authority.',
    versionTarget: 'subject task, action, or routine',
  },
  'reminder.clear': {
    summary: 'Bring a snoozed task/action/routine reminder back. Human only.',
    versionTarget: 'reminder record',
  },
  'person.create': {
    summary:
      'Create a contact and third-party identity atomically. Name and reason required; group defaults to Other. No account or message is created.',
    versionTarget: 'none',
  },
  'person.update': {
    summary:
      'Edit or archive a contact profile. Profile changes do not count as meaningful contact; unresolved commitments remain visible.',
    versionTarget: 'person',
  },
  'person.import': {
    summary:
      'Import one reviewed profile and optional birthday atomically. Existing profile/birthday updates require reviewed versions. Empty imported fields never erase values; no automatic duplicate merge.',
    versionTarget: 'person and optional birthday for updates; none for new records',
  },
  'relationship_group.create': {
    summary: 'Create a relationship group with cadence days or null for off.',
    versionTarget: 'none',
  },
  'relationship_group.update': {
    summary: 'Change group name or cadence inherited by contacts.',
    versionTarget: 'relationship group',
  },
  'interaction.log': {
    summary:
      'Record an observed interaction, channel, date, summary, and meaningful flag. Does not send a message. Only meaningful non-voided interactions reset cadence.',
    versionTarget: 'none',
  },
  'interaction.correct': {
    summary: 'Correct or void an interaction while preserving audit history.',
    versionTarget: 'interaction',
  },
  'important_date.create': {
    summary:
      'Add birthday, anniversary, or named date. Annual dates may omit year; birthdays must be annual and one-time dates require year.',
    versionTarget: 'none',
  },
  'important_date.update': {
    summary: 'Edit or disable an important date. Changes can invalidate occurrence reminders.',
    versionTarget: 'important date',
  },
  'commitment.create': {
    summary:
      'Record waiting_on or i_owe work with a human/agent coordinator, initially requested. Task links are informational unless human-required; linking needs task access.',
    versionTarget: 'none',
  },
  'commitment.update': {
    summary:
      'Edit commitment details, dates, or links. Only the human can change required status or move required work to another task. Linking needs task access.',
    versionTarget: 'commitment',
  },
  'commitment.transition': {
    summary:
      'Record a commitment state with a note. Fulfillment requires committed/reported_done; terminal states reopen as requested/committed. Only the human may waive. Never auto-completes a task.',
    versionTarget: 'commitment',
  },
  'people_reminder.respond': {
    summary:
      'Snooze a current People reminder or acknowledge an occasion. Use the attention projection occurrenceKey and subject version. Contact/commitment acknowledgment is not allowed.',
    versionTarget: 'attention item subject version',
  },
};
