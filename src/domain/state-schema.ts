import { z } from 'zod';
import { peopleStateFields } from './people-schema';
import { taskLinksSchema } from './task-links';
const id = z.guid(),
  text = z.string(),
  date = z.string().datetime({ offset: true });
const base = { id, version: z.number().int().positive(), createdAt: date, updatedAt: date };
const parent = { workstreamId: id.optional(), operationId: id.optional() };
const oneParent = (v: { workstreamId?: string; operationId?: string }) =>
  Boolean(v.workstreamId) !== Boolean(v.operationId);
const link = z
  .string()
  .url()
  .refine((v) => /^https?:/.test(v));
const identity = z
  .object({
    id,
    name: text,
    kind: z.enum(['human', 'agent', 'integration', 'third_party']),
    role: z.string().max(100).optional(),
  })
  .strict();
const workstream = z
  .object({
    ...base,
    projectId: id.nullable().default(null),
    priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']).default('none'),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
    planningStage: z.enum(['todo', 'in_progress']).default('todo'),
    completionPolicy: z.enum(['simple', 'verified']).default('verified'),
    title: text,
    outcome: text,
    ownerId: id,
    mode: z.enum(['human_led', 'assisted', 'approval_required', 'autonomous']),
    assignedAgentIds: z.array(id),
    criteria: z.array(z.object({ id, text }).strict()),
    nextAction: z
      .object({
        text,
        ownerId: id,
        dependency: text.optional(),
        requiredAuthority: text.optional(),
      })
      .strict()
      .nullable(),
    status: z.enum(['open', 'blocked', 'ready_for_review', 'completed', 'cancelled', 'dismissed']),
    reviewAt: date,
    reportedProgress: text,
    verifiedAt: date.nullable(),
    links: taskLinksSchema.default([]),
    blocker: z
      .object({ cause: text, attemptedResolution: text, unblockCondition: text, resolverId: id })
      .strict()
      .nullable(),
    references: z.array(
      z
        .object({
          id,
          system: text,
          objectId: text,
          url: link.optional(),
          responsibility: text,
          reportedStatus: text.optional(),
          checkedAt: date.optional(),
          conflict: text.optional(),
        })
        .strict(),
    ),
    closure: z
      .object({ reason: text, actorId: id, evidenceIds: z.array(id), at: date })
      .strict()
      .optional(),
  })
  .passthrough();
const operation = z
  .object({
    ...base,
    title: text,
    purpose: text,
    ownerId: id,
    assignedAgentIds: z.array(id),
    cadenceHours: z.number().positive(),
    expectedAt: date,
    grantId: id.optional(),
    latestExecutionId: id.optional(),
    latestVerifiedExecutionId: id.optional(),
    incidents: z.array(z.object({ key: text, workstreamId: id }).strict()),
  })
  .passthrough();
const action = z
  .object({
    ...base,
    workstreamId: id,
    revision: z.number().int().positive(),
    supersedesId: id.optional(),
    operation: text,
    effect: text,
    target: text,
    content: text,
    scope: text,
    expiresAt: date,
    declaredCost: z.number().nonnegative(),
    currency: z.string().length(3),
    approvalRequested: z.boolean(),
  })
  .passthrough();
const grant = z
  .object({
    ...base,
    ...parent,
    type: z.enum(['one_time', 'standing']),
    actionId: id.optional(),
    operations: z.array(text).min(1),
    targets: z.array(text).min(1),
    granteeId: id,
    validFrom: date,
    expiresAt: date,
    maxUses: z.number().int().positive(),
    used: z.number().int().nonnegative(),
    costLimit: z.number().nonnegative().optional(),
    declaredCostUsed: z.number().nonnegative(),
    currency: z.string().length(3),
    revokedAt: date.nullable(),
    approvedBy: id,
  })
  .passthrough()
  .refine(oneParent)
  .refine((g) => g.used <= g.maxUses);
const execution = z
  .object({
    ...base,
    ...parent,
    actionId: id.optional(),
    grantId: id,
    actorId: id,
    state: z.enum(['running', 'succeeded', 'partial', 'failed', 'uncertain']),
    result: text,
    externalId: text.optional(),
    reconciledAt: date.optional(),
    reconciliation: text.optional(),
    verifiedAt: date.optional(),
    evidenceIds: z.array(id),
    incidentKey: text.optional(),
  })
  .passthrough()
  .refine(oneParent);
const evidence = z
  .object({
    ...base,
    ...parent,
    executionId: id.optional(),
    criterionIds: z.array(id),
    title: text,
    description: text,
    url: link.optional(),
    storagePath: text.optional(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    provenance: text,
    submittedBy: id,
    verification: z.enum(['unverified', 'accepted', 'independent']),
    verifiedBy: id.optional(),
    verifiedAt: date.optional(),
    verificationNote: text.optional(),
  })
  .passthrough()
  .refine(oneParent);
export const archiveStateSchema = z
  .object({
    ...peopleStateFields,
    workspaceId: id,
    revision: z.number().int().nonnegative(),
    projects: z
      .array(
        z
          .object({
            ...base,
            name: text,
            description: text,
            targetDate: z.string().nullable(),
            status: z.enum(['active', 'archived']),
          })
          .strict(),
      )
      .default([]),
    decisions: z
      .array(
        z
          .object({
            ...base,
            workstreamId: id,
            subjectId: id,
            subjectVersion: z.number().int().positive(),
            response: z.enum(['approved', 'declined', 'changes_requested', 'accepted']),
            actorId: id,
            feedback: text,
          })
          .strict(),
      )
      .default([]),
    reminders: z
      .array(
        z
          .object({
            ...base,
            subjectId: id,
            subjectVersion: z.number().int().positive(),
            until: date,
            actorId: id,
          })
          .strict(),
      )
      .default([]),
    identities: z.array(identity),
    workstreams: z.array(workstream),
    operations: z.array(operation),
    actions: z.array(action),
    grants: z.array(grant),
    executions: z.array(execution),
    evidence: z.array(evidence),
    audit: z.array(
      z
        .object({
          id,
          actorId: id,
          entityId: id,
          at: date,
          command: text,
          reason: text,
          changes: z.unknown(),
        })
        .strict(),
    ),
  })
  .strict();
