import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { schemas } from '../src/domain/commands';
import { failure } from '../src/server/http';

// This UUID-like identifier was accepted by Zod 3 and may exist in old archives.
const legacyId = '00000000-0000-0000-0000-000000000001';
const update = { entityId: legacyId, expectedVersion: 1, reason: 'Compatibility check' };

describe('patched Zod and request compatibility', () => {
  it('rejects oversized constrained collections before traversing their elements', () => {
    let visits = 0;
    const criterion = {
      get id() {
        visits++;
        return legacyId;
      },
      get text() {
        visits++;
        return 'A criterion';
      },
    };
    const result = schemas['workstream.update'].safeParse({
      ...update,
      criteria: Array(51).fill(criterion),
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('Oversized collection accepted');
    expect(result.error.issues).toMatchObject([{ code: 'too_big', path: ['criteria'] }]);
    expect(visits).toBe(0);
    expect(
      schemas['workstream.update'].safeParse({
        ...update,
        criteria: Array(50).fill({ id: legacyId, text: 'A criterion' }),
      }).success,
    ).toBe(true);
  });

  it('retains legacy identifiers, request defaults, strict fields, and domain refinements', () => {
    const created = schemas['workstream.create'].parse({
      title: '  Existing client  ',
      outcome: 'Outcome',
      ownerId: legacyId,
      criteria: [{ id: legacyId, text: 'Accepted result' }],
      nextAction: null,
      reason: 'Create',
    });
    expect(created).toMatchObject({
      title: 'Existing client',
      mode: 'assisted',
      assignedAgentIds: [],
      references: [],
    });
    expect(created.completionPolicy).toBeUndefined(); // The service supplies the verified default.
    expect(schemas['workstream.update'].safeParse({ ...update, entityId: 'invalid' }).success).toBe(
      false,
    );
    expect(schemas['workstream.update'].safeParse({ ...update, actorId: legacyId }).success).toBe(
      false,
    );
    expect(
      schemas['workstream.update'].safeParse({ ...update, dueDate: '2026-02-30' }).success,
    ).toBe(false);
    expect(
      schemas['evidence.attach'].safeParse({
        workstreamId: legacyId,
        operationId: legacyId,
        expectedVersion: 1,
        title: 'Evidence',
        description: 'Result',
        provenance: 'Source',
        reason: 'Attach',
      }).success,
    ).toBe(false);
  });

  it('publishes input schemas without turning defaulted fields into required fields', async () => {
    const document = JSON.parse(await readFile('docs/openapi.json', 'utf8'));
    for (const name of Object.keys(schemas)) {
      const input =
        document.paths[`/api/v1/commands/${name}`].post.requestBody.content['application/json']
          .schema;
      expect(input.type).toBe('object');
      expect(input.additionalProperties).toBe(false);
      expect(Object.keys(input.properties).length).toBeGreaterThan(0);
    }
    const input =
      document.paths['/api/v1/commands/workstream.create'].post.requestBody.content[
        'application/json'
      ].schema;
    expect(input.required).toEqual([
      'title',
      'outcome',
      'ownerId',
      'criteria',
      'nextAction',
      'reason',
    ]);
    expect(input.properties.criteria.maxItems).toBe(50);
    expect(input.properties.assignedAgentIds.default).toEqual([]);
    expect(input.properties.mode.default).toBe('assisted');
  });

  it('retains the public validation error envelope with field and form errors', async () => {
    const parsed = schemas['workstream.update'].safeParse({ ...update, expectedVersion: 0 });
    if (parsed.success) throw new Error('Invalid version accepted');
    const response = failure(parsed.error);
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.code).toBe('validation');
    expect(payload.error.details.formErrors).toEqual([]);
    expect(payload.error.details.fieldErrors.expectedVersion).toHaveLength(1);
  });
});
