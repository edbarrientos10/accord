import { describe, it, expect } from 'vitest';
import { fixture } from './helpers';
import {
  decisionQueue,
  filterTodayQueue,
  todayAudience,
  todayFilter,
} from '../src/domain/presentation';
const now = Date.parse('2026-11-04T12:00:00Z');
function setup() {
  const f = fixture();
  const w = f.create();
  return { f, w: f.current(w.id), queue: () => decisionQueue(f.state, now) };
}
describe('Today responsibility filters', () => {
  it('defaults missing and unknown filters to Needs me while preserving explicit All links', () => {
    expect(todayFilter(null)).toBe('needs-me');
    expect(todayFilter('unknown')).toBe('needs-me');
    expect(todayFilter('all')).toBe('all');
  });
  it('keeps an automatic review reminder out of Needs me despite human task ownership', () => {
    const { f, queue } = setup();
    expect(queue()).toHaveLength(1);
    expect(todayAudience(queue()[0], f.state)).toBe('monitoring');
    expect(filterTodayQueue(queue(), f.state, 'needs-me')).toHaveLength(0);
  });
  it('puts overdue agent work in Agent work and third-party waiting in Monitoring', () => {
    const { f, w, queue } = setup();
    w.dueDate = '2026-11-03';
    expect(filterTodayQueue(queue(), f.state, 'agent')).toHaveLength(1);
    expect(filterTodayQueue(queue(), f.state, 'needs-me')).toHaveLength(0);
    w.nextAction!.ownerId = f.thirdId;
    expect(filterTodayQueue(queue(), f.state, 'monitoring')).toHaveLength(1);
  });
  it('follows the blocker resolver rather than task ownership or the next action', () => {
    const { f, w, queue } = setup();
    w.nextAction!.ownerId = f.human.id;
    w.blocker = {
      cause: 'Missing file',
      attemptedResolution: 'Checked',
      unblockCondition: 'File arrives',
      resolverId: f.agent.id,
    };
    w.status = 'blocked';
    expect(filterTodayQueue(queue(), f.state, 'agent')).toHaveLength(1);
    expect(filterTodayQueue(queue(), f.state, 'blocker')).toHaveLength(0);
    w.blocker.resolverId = f.human.id;
    expect(filterTodayQueue(queue(), f.state, 'needs-me')).toHaveLength(1);
    expect(filterTodayQueue(queue(), f.state, 'blocker')).toHaveLength(1);
  });
  it('retains human next steps and completion reviews on agent-owned tasks', () => {
    const { f, w, queue } = setup();
    w.ownerId = f.agent.id;
    w.nextAction!.ownerId = f.human.id;
    expect(filterTodayQueue(queue(), f.state, 'needs-me')).toHaveLength(1);
    w.nextAction!.ownerId = f.agent.id;
    w.status = 'ready_for_review';
    expect(filterTodayQueue(queue(), f.state, 'needs-me')).toHaveLength(1);
    expect(filterTodayQueue(queue(), f.state, 'review')).toHaveLength(1);
  });
  it('keeps independent approvals in Needs me even for agent-owned work', () => {
    const { f, w, queue } = setup();
    const a = f.command('action.propose', {
      workstreamId: w.id,
      expectedVersion: w.version,
      operation: 'send',
      effect: 'Send draft',
      target: 'fictional',
      scope: 'One message',
      content: 'Draft',
      expiresAt: '2099-01-01T00:00:00Z',
      reason: 'Propose',
    }) as { id: string; version: number };
    f.command('action.request_approval', {
      entityId: a.id,
      expectedVersion: a.version,
      reason: 'Request',
    });
    f.current(w.id).ownerId = f.agent.id;
    expect(filterTodayQueue(queue(), f.state, 'needs-me').map((q) => q.subjectId)).toEqual([a.id]);
  });
  it('treats conflicts as monitoring unless there is an explicit human next step', () => {
    const { f, w, queue } = setup();
    w.references.push({
      id: 'source',
      system: 'test',
      objectId: 'file',
      responsibility: 'Reference',
      conflict: 'Versions disagree',
    });
    expect(filterTodayQueue(queue(), f.state, 'monitoring')).toHaveLength(1);
    w.nextAction!.ownerId = f.human.id;
    expect(filterTodayQueue(queue(), f.state, 'needs-me')).toHaveLength(1);
  });
  it('keeps snoozed items separate and returns resolved tasks to the correct queue', () => {
    const { f, w, queue } = setup();
    w.nextAction!.ownerId = f.human.id;
    f.state.reminders.push({
      id: 'reminder',
      version: 1,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
      subjectId: w.id,
      subjectVersion: w.version,
      until: '2099-01-01T00:00:00Z',
      actorId: f.human.id,
    });
    expect(filterTodayQueue(queue(), f.state, 'needs-me')).toHaveLength(0);
    expect(filterTodayQueue(queue(), f.state, 'all')).toHaveLength(0);
    expect(filterTodayQueue(queue(), f.state, 'snoozed')).toHaveLength(1);
    f.state.reminders = [];
    w.status = 'dismissed';
    expect(queue()).toHaveLength(0);
    w.status = 'open';
    expect(filterTodayQueue(queue(), f.state, 'needs-me')).toHaveLength(1);
  });
  it('routes routine health alerts to Monitoring regardless of owner', () => {
    const { f, queue } = setup();
    f.state.operations.push({
      id: 'routine',
      version: 1,
      title: 'Daily check',
      ownerId: f.human.id,
      expectedAt: '2026-11-03T12:00:00Z',
      createdAt: '2026-11-01T12:00:00Z',
      updatedAt: '2026-11-01T12:00:00Z',
    } as (typeof f.state.operations)[number]);
    expect(
      filterTodayQueue(queue(), f.state, 'monitoring').some((q) => q.operationId === 'routine'),
    ).toBe(true);
    expect(filterTodayQueue(queue(), f.state, 'needs-me')).toHaveLength(0);
  });
});
