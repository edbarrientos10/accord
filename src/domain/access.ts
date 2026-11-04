import type { Actor } from './types';
import { humanOnly, workspaceCommandScopes } from './permissions';
import type { CommandName } from './commands';

export function hasWorkspaceAccess(actor: Actor) {
  return actor.kind === 'agent' && actor.accessMode === 'workspace';
}
export function canAccess(actor: Actor, id: string) {
  return actor.kind === 'human' || hasWorkspaceAccess(actor) || actor.assignments.includes(id);
}
export function canAccessRecord(actor: Actor, record: { id: string; assignedAgentIds: string[] }) {
  return (
    canAccess(actor, record.id) &&
    (actor.kind !== 'agent' ||
      hasWorkspaceAccess(actor) ||
      record.assignedAgentIds.includes(actor.id))
  );
}
export function canUseCommand(actor: Actor, name: CommandName) {
  return (
    actor.kind === 'human' ||
    (actor.scopes.includes(name) &&
      !humanOnly.has(name) &&
      (!(workspaceCommandScopes as readonly string[]).includes(name) || hasWorkspaceAccess(actor)))
  );
}
