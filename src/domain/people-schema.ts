import { z } from 'zod';
const id = z.guid();
// Zod 4 applies defaults inside optional fields. PATCH schemas must omit those defaults.
function patch<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  type Fields = { [K in keyof T]: z.ZodOptional<T[K] extends z.ZodDefault<infer U> ? U : T[K]> };
  return z
    .object(
      Object.fromEntries(
        Object.entries(schema.shape).map(([k, v]) => [
          k,
          z.optional(v instanceof z.ZodDefault ? v.removeDefault() : v),
        ]),
      ) as Fields,
    )
    .strict();
}
const text = z.string().trim().min(1).max(10000);
const optionalText = z.string().trim().max(10000);
const instant = z.string().datetime({ offset: true });
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Invalid calendar date',
  );
export const timezoneSchema = z.string().refine((v) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: v });
    return true;
  } catch {
    return false;
  }
}, 'Choose an IANA timezone');
const record = { id, version: z.number().int().positive(), createdAt: instant, updatedAt: instant };
const command = { entityId: id, expectedVersion: z.number().int().positive(), reason: text };
const labeled = z.object({ label: z.string().max(100), value: text }).strict();
export const profileFields = z
  .object({
    name: text,
    organization: optionalText.default(''),
    role: optionalText.default(''),
    groupId: id,
    tags: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    notes: optionalText.default(''),
    emails: z
      .array(labeled.extend({ value: z.email() }))
      .max(30)
      .default([]),
    phones: z.array(labeled).max(30).default([]),
    links: z
      .array(labeled.extend({ value: z.url().refine((v) => /^https?:/.test(v)) }))
      .max(30)
      .default([]),
    cadenceMode: z.enum(['inherit', 'custom', 'paused']).default('inherit'),
    cadenceDays: z.number().int().min(1).max(3650).nullable().default(null),
    status: z.enum(['active', 'archived']).default('active'),
    externalIds: z.array(z.string().max(500)).max(30).default([]),
  })
  .strict();
export const personSchema = profileFields.extend(record);
export const groupSchema = z
  .object({ ...record, name: text, cadenceDays: z.number().int().min(1).max(3650).nullable() })
  .strict();
const interactionFields = z
  .object({
    personId: id,
    occurredAt: instant,
    channel: z.enum(['meeting', 'call', 'message', 'email', 'other']),
    summary: text,
    meaningful: z.boolean(),
    source: optionalText.default(''),
    voided: z.boolean().default(false),
  })
  .strict();
export const interactionSchema = interactionFields.extend({ ...record, actorId: id });
const occasionFields = z
  .object({
    personId: id,
    title: text,
    kind: z.enum(['birthday', 'anniversary', 'other']),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
    year: z.number().int().min(1).max(9999).nullable().default(null),
    annual: z.boolean().default(true),
    advance: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .strict();
export const occasionSchema = occasionFields.extend(record);
export const commitmentStates = [
  'requested',
  'committed',
  'reported_done',
  'fulfilled',
  'declined',
  'cancelled',
  'waived',
] as const;
const commitmentFields = z
  .object({
    personId: id,
    direction: z.enum(['waiting_on', 'i_owe']),
    title: text,
    coordinatorId: id,
    promisedDate: calendarDate.nullable().default(null),
    followUpAt: instant.nullable().default(null),
    priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']).default('none'),
    source: optionalText.default(''),
    workstreamId: id.nullable().default(null),
    projectId: id.nullable().default(null),
    required: z.boolean().default(false),
  })
  .strict();
export const commitmentSchema = commitmentFields.extend({
  ...record,
  status: z.enum(commitmentStates),
  note: optionalText,
});
export const responseSchema = z
  .object({
    ...record,
    subjectId: id,
    subjectVersion: z.number().int().positive(),
    occurrenceKey: text,
    response: z.enum(['acknowledged', 'snoozed']),
    until: instant.nullable(),
    actorId: id,
  })
  .strict();
export const peopleSchemas = {
  'person.import': z
    .object({
      entityId: id.optional(),
      expectedVersion: z.number().int().positive().optional(),
      profile: patch(profileFields),
      birthday: z
        .object({
          month: z.number().int(),
          day: z.number().int(),
          year: z.number().int().nullable(),
          entityId: id.optional(),
          expectedVersion: z.number().int().positive().optional(),
        })
        .strict()
        .optional(),
      reason: text,
    })
    .strict(),
  'person.create': profileFields.partial({ groupId: true }).extend({ reason: text }),
  'person.update': patch(profileFields).extend(command),
  'relationship_group.create': z
    .object({ name: text, cadenceDays: z.number().int().min(1).max(3650).nullable(), reason: text })
    .strict(),
  'relationship_group.update': z
    .object({
      ...command,
      name: text.optional(),
      cadenceDays: z.number().int().min(1).max(3650).nullable().optional(),
    })
    .strict(),
  'interaction.log': interactionFields.extend({ reason: text }),
  'interaction.correct': patch(interactionFields).extend(command),
  'important_date.create': occasionFields.extend({ reason: text }),
  'important_date.update': patch(occasionFields).extend(command),
  'commitment.create': commitmentFields.extend({ reason: text }),
  'commitment.update': patch(commitmentFields).extend(command),
  'commitment.transition': z
    .object({ ...command, status: z.enum(commitmentStates), note: text })
    .strict(),
  'people_reminder.respond': z
    .object({
      ...command,
      occurrenceKey: text,
      response: z.enum(['acknowledged', 'snoozed']),
      until: instant.nullable().default(null),
    })
    .strict(),
  'workspace.timezone': z
    .object({
      expectedVersion: z.number().int().nonnegative(),
      timezone: timezoneSchema,
      reason: text,
    })
    .strict(),
};
export type Person = z.infer<typeof personSchema>;
export type RelationshipGroup = z.infer<typeof groupSchema>;
export type Interaction = z.infer<typeof interactionSchema>;
export type ImportantDate = z.infer<typeof occasionSchema>;
export type Commitment = z.infer<typeof commitmentSchema>;
export type PeopleResponse = z.infer<typeof responseSchema>;
export const groupDefaults = [
  ['Family', 30],
  ['Friends', 60],
  ['Professional', 90],
  ['Other', null],
] as const;
export function defaultGroups(now = '2026-01-01T00:00:00.000Z'): RelationshipGroup[] {
  return groupDefaults.map(([name, cadenceDays], i) => ({
    id: `10000000-0000-4000-8000-00000000000${i + 1}`,
    version: 1,
    createdAt: now,
    updatedAt: now,
    name,
    cadenceDays,
  }));
}
export const otherGroupId = '10000000-0000-4000-8000-000000000004';
export function minimalPerson(id: string, name: string, now: string): Person {
  return personSchema.parse({
    id,
    name,
    groupId: otherGroupId,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
}
export const peopleStateFields = {
  timezone: timezoneSchema.default('America/Monterrey'),
  people: z.array(personSchema).default([]),
  relationshipGroups: z.array(groupSchema).default(() => defaultGroups()),
  interactions: z.array(interactionSchema).default([]),
  importantDates: z.array(occasionSchema).default([]),
  commitments: z.array(commitmentSchema).default([]),
  peopleResponses: z.array(responseSchema).default([]),
};
