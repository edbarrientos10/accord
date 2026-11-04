import { z } from 'zod';
import { peopleSchemas } from './people-schema';
import { taskLinksSchema } from './task-links';
const text = z.string().trim().min(1).max(10000);
// Preserve the Zod 3 identifier contract for existing records and clients.
const id = z.guid();
const date = z.string().datetime({ offset: true });
const base = { entityId: id, expectedVersion: z.number().int().positive(), reason: text };
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Invalid calendar date',
  );
const planning = {
  projectId: id.nullable().optional(),
  priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']).optional(),
  dueDate: calendarDate.nullable().optional(),
  planningStage: z.enum(['todo', 'in_progress']).optional(),
  completionPolicy: z.enum(['simple', 'verified']).optional(),
};
const criterion = z.object({ id, text }).strict();
const next = z
  .object({ text, ownerId: id, dependency: text.optional(), requiredAuthority: text.optional() })
  .strict();
const reference = z
  .object({
    id,
    system: text,
    objectId: text,
    url: z
      .string()
      .url()
      .refine((v) => /^https?:/.test(v))
      .optional(),
    responsibility: text,
    reportedStatus: text.optional(),
    checkedAt: date.optional(),
    conflict: text.optional(),
  })
  .strict();
export const schemas = {
  ...peopleSchemas,
  'profile.update': z
    .object({
      name: z.string().trim().min(1).max(100),
      role: z.string().trim().max(100),
      expectedVersion: z.number().int().nonnegative(),
      reason: text,
    })
    .strict(),
  'project.create': z
    .object({
      name: text,
      description: z.string().max(10000).default(''),
      targetDate: calendarDate.nullable().default(null),
      reason: text,
    })
    .strict(),
  'project.update': z
    .object({
      ...base,
      name: text.optional(),
      description: z.string().max(10000).optional(),
      targetDate: calendarDate.nullable().optional(),
      status: z.enum(['active', 'archived']).optional(),
    })
    .strict(),
  'decision.respond': z
    .object({ ...base, response: z.enum(['declined', 'changes_requested']), feedback: text })
    .strict(),
  'reminder.snooze': z.object({ ...base, until: date }).strict(),
  'reminder.clear': z.object(base).strict(),
  'workstream.create': z
    .object({
      ...planning,
      title: text,
      outcome: text,
      ownerId: id,
      assignedAgentIds: z.array(id).default([]),
      mode: z
        .enum(['human_led', 'assisted', 'approval_required', 'autonomous'])
        .default('assisted'),
      criteria: z.array(criterion).max(50),
      nextAction: next.nullable(),
      reviewAt: date.optional(),
      references: z.array(reference).default([]),
      links: taskLinksSchema.default([]),
      reason: text,
    })
    .strict(),
  'workstream.update': z
    .object({
      ...planning,
      ...base,
      title: text.optional(),
      outcome: text.optional(),
      ownerId: id.optional(),
      assignedAgentIds: z.array(id).optional(),
      mode: z.enum(['human_led', 'assisted', 'approval_required', 'autonomous']).optional(),
      nextAction: next.nullable().optional(),
      reviewAt: date.optional(),
      reportedProgress: text.optional(),
      references: z.array(reference).optional(),
      links: taskLinksSchema.optional(),
      criteria: z.array(criterion).max(50).optional(),
    })
    .strict(),
  'workstream.block': z
    .object({
      ...base,
      cause: text,
      attemptedResolution: text,
      unblockCondition: text,
      resolverId: id,
    })
    .strict(),
  'workstream.unblock': z.object(base).strict(),
  'workstream.review': z.object(base).strict(),
  'workstream.close': z
    .object({ ...base, evidenceIds: z.array(id), humanConfirmation: text.optional() })
    .strict(),
  'workstream.terminate': z
    .object({ ...base, disposition: z.enum(['cancelled', 'dismissed']) })
    .strict(),
  'workstream.reopen': z.object(base).strict(),
  'action.propose': z
    .object({
      workstreamId: id,
      expectedVersion: z.number().int().positive(),
      operation: text,
      effect: text,
      target: text,
      content: text,
      scope: text,
      expiresAt: date,
      declaredCost: z.number().nonnegative().default(0),
      currency: z.string().length(3).default('USD'),
      supersedesId: id.optional(),
      reason: text,
    })
    .strict(),
  'action.request_approval': z.object(base).strict(),
  'grant.approve': z.object({ ...base, granteeId: id }).strict(),
  'grant.standing': z
    .object({
      workstreamId: id.optional(),
      operationId: id.optional(),
      expectedVersion: z.number().int().positive(),
      granteeId: id,
      operations: z.array(text).min(1),
      targets: z.array(text).min(1),
      validFrom: date,
      expiresAt: date,
      maxUses: z.number().int().positive().max(1000000),
      costLimit: z.number().nonnegative().optional(),
      currency: z.string().length(3).default('USD'),
      reason: text,
    })
    .strict()
    .refine(
      (v) => Boolean(v.workstreamId) !== Boolean(v.operationId),
      'Choose exactly one workstream or operation',
    ),
  'grant.revoke': z.object(base).strict(),
  'execution.start': z
    .object({
      actionId: id.optional(),
      operationId: id.optional(),
      expectedVersion: z.number().int().positive(),
      grantId: id,
      operation: text.optional(),
      target: text.optional(),
      declaredCost: z.number().nonnegative().default(0),
      currency: z.string().length(3).default('USD'),
      reason: text,
    })
    .strict()
    .refine(
      (v) => Boolean(v.actionId) !== Boolean(v.operationId),
      'Choose exactly one action or operation',
    ),
  'execution.report': z
    .object({
      ...base,
      state: z.enum(['succeeded', 'partial', 'failed', 'uncertain']),
      result: text,
      externalId: text.optional(),
      incidentKey: text.optional(),
    })
    .strict(),
  'execution.reconcile': z
    .object({
      ...base,
      state: z.enum(['succeeded', 'partial', 'failed']),
      result: text,
      externalId: text.optional(),
      evidenceIds: z.array(id).min(1),
    })
    .strict(),
  'evidence.attach': z
    .object({
      workstreamId: id.optional(),
      operationId: id.optional(),
      expectedVersion: z.number().int().positive(),
      executionId: id.optional(),
      criterionIds: z.array(id).default([]),
      title: text,
      description: text,
      provenance: text,
      url: z
        .string()
        .url()
        .refine((v) => /^https?:/.test(v))
        .optional(),
      storagePath: text.optional(),
      sha256: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      reason: text,
    })
    .strict()
    .refine(
      (v) => Boolean(v.workstreamId) !== Boolean(v.operationId),
      'Choose exactly one workstream or operation',
    ),
  'evidence.verify': z.object({ ...base, note: text }).strict(),
  'evidence.invalidate': z.object(base).strict(),
  'operation.create': z
    .object({
      title: text,
      purpose: text,
      ownerId: id,
      assignedAgentIds: z.array(id).default([]),
      cadenceHours: z.number().positive().max(87600),
      expectedAt: date,
      reason: text,
    })
    .strict(),
  'operation.update': z
    .object({
      ...base,
      title: text.optional(),
      purpose: text.optional(),
      cadenceHours: z.number().positive().max(87600).optional(),
      expectedAt: date.optional(),
      assignedAgentIds: z.array(id).optional(),
    })
    .strict(),
  'identity.create': z
    .object({ name: text, kind: z.enum(['agent', 'integration', 'third_party']), reason: text })
    .strict(),
};
export type CommandName = keyof typeof schemas;
export { humanOnly, agentScopes } from './permissions';
export function parseCommand(name: string, input: unknown) {
  if (!(name in schemas)) throw new Error('Unknown command');
  return schemas[name as CommandName].parse(input);
}
