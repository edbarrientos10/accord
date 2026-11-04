import type { CommandName } from './commands';
export const humanOnly = new Set<CommandName>([
  'workspace.timezone',
  'profile.update',
  'decision.respond',
  'reminder.snooze',
  'reminder.clear',
  'grant.approve',
  'grant.standing',
  'grant.revoke',
  'identity.create',
  'evidence.invalidate',
]);
/** Browser-safe capability names; validation schemas remain in the server graph. */
export const peopleScopes = [
  'person.import',
  'person.create',
  'person.update',
  'relationship_group.create',
  'relationship_group.update',
  'interaction.log',
  'interaction.correct',
  'important_date.create',
  'important_date.update',
  'commitment.create',
  'commitment.update',
  'commitment.transition',
  'people_reminder.respond',
] satisfies CommandName[];
export const agentScopes = [
  ...peopleScopes,
  'workstream.update',
  'workstream.block',
  'workstream.unblock',
  'workstream.review',
  'workstream.close',
  'action.propose',
  'action.request_approval',
  'execution.start',
  'execution.report',
  'execution.reconcile',
  'evidence.attach',
] satisfies CommandName[];

/** Management commands require both workspace access and their exact scope. */
export const workspaceCommandScopes = [
  'project.create',
  'project.update',
  'workstream.create',
  'workstream.reopen',
  'workstream.terminate',
  'operation.create',
  'operation.update',
] satisfies CommandName[];
export const workspaceAgentScopes = [...workspaceCommandScopes, 'workstream.manage'] as const;
