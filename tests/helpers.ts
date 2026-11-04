import { randomUUID } from 'node:crypto';
import type { Actor, State, Workstream } from '../src/domain/types';
import { emptyState } from '../src/domain/types';
import { applyCommand } from '../src/domain/service';
import { assert } from '../src/domain/errors';
import type { Repository } from '../src/server/repository';
export function fixture() {
  const workspace = randomUUID(),
    humanId = randomUUID(),
    agentId = randomUUID(),
    thirdId = randomUUID();
  let state = emptyState(workspace);
  state.identities = [
    { id: humanId, name: 'Fictional owner', kind: 'human', authUserId: randomUUID() },
    { id: agentId, name: 'Fictional agent', kind: 'agent' },
    { id: thirdId, name: 'Fictional supplier', kind: 'third_party' },
  ];
  const human: Actor = {
    id: humanId,
    workspaceId: workspace,
    kind: 'human',
    scopes: ['*'],
    assignments: [],
  };
  const agent: Actor = {
    id: agentId,
    workspaceId: workspace,
    kind: 'agent',
    scopes: [
      'read',
      'workstream.update',
      'workstream.block',
      'workstream.review',
      'workstream.close',
      'action.propose',
      'action.request_approval',
      'execution.start',
      'execution.report',
      'execution.reconcile',
      'evidence.attach',
      'evidence.verify',
    ],
    assignments: [],
  };
  const command = (name: string, input: unknown, actor = human) => {
    const result = applyCommand(state, actor, name, input, '2026-10-12T12:00:00.000Z');
    state = result.state;
    return result.result;
  };
  const create = () => {
    const w = command('workstream.create', {
      title: 'Fictional contract',
      outcome: 'An agreed contract',
      ownerId: humanId,
      assignedAgentIds: [agentId],
      criteria: [{ id: randomUUID(), text: 'The contract is accepted' }],
      nextAction: { text: 'Prepare a proposal', ownerId: agentId },
      reason: 'Begin the collaboration',
    }) as Workstream;
    agent.assignments.push(w.id);
    return w;
  };
  const attempts: { actorId: string; event: import('../src/server/attempts').CommandAttempt }[] =
    [];
  return {
    attempts,
    get state() {
      return state;
    },
    set state(s: State) {
      state = s;
    },
    human,
    agent,
    thirdId,
    command,
    create,
    current: (id: string) => state.workstreams.find((w) => w.id === id)!,
  };
}
export class MemoryRepository implements Repository {
  retries = new Map<string, { hash: string; result: unknown }>();
  attempts: { actorId: string; event: import('../src/server/attempts').CommandAttempt }[] = [];
  async recordAttempt(actor: Actor, event: import('../src/server/attempts').CommandAttempt) {
    this.attempts.push({ actorId: actor.id, event: structuredClone(event) });
  }
  constructor(public state: State) {}
  async load(workspaceId: string, options: { history?: boolean } = {}) {
    assert(workspaceId === this.state.workspaceId, 'not_found', 'Workspace not found.', 404);
    return structuredClone({
      ...this.state,
      audit: options.history === false ? [] : this.state.audit,
    });
  }
  async replay(actor: Actor, key: string, hash: string) {
    const prior = this.retries.get(`${actor.id}:${key}`);
    if (prior) {
      assert(prior.hash === hash, 'idempotency_mismatch', 'Changed retry content.', 409);
      return structuredClone(prior.result);
    }
  }
  async commit(
    actor: Actor,
    key: string,
    hash: string,
    before: State,
    after: State,
    result: unknown,
  ) {
    const prior = await this.replay(actor, key, hash);
    if (prior !== undefined) return { result: prior };
    if (this.state.revision !== before.revision) return { conflict: true };
    this.state = structuredClone({
      ...after,
      audit: [
        ...new Map(
          [...this.state.audit, ...after.audit].map((event) => [event.id, event]),
        ).values(),
      ],
    });
    this.retries.set(`${actor.id}:${key}`, { hash, result: structuredClone(result) });
    return { result };
  }
}
