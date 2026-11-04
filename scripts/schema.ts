import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { format } from 'prettier';
import { z } from 'zod';
import { workspaceCommandScopes } from '../src/domain/permissions';
import { schemas, humanOnly } from '../src/domain/commands';
import { commandInfo } from '../src/domain/command-info';
const security = [{ bearerAuth: [] }];
const idSchema = { type: 'string', format: 'uuid' };
const jsonResponse = (description: string, schema: object = { type: 'object' }) => ({
  description,
  content: { 'application/json': { schema } },
});
const retryHeader = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  schema: { type: 'string', pattern: '^[\\w.-]{8,128}$', minLength: 8, maxLength: 128 },
};
const idParameter = { name: 'id', in: 'path', required: true, schema: idSchema };
const jsonBody = (schema: object) => ({
  required: true,
  content: { 'application/json': { schema } },
});
const errors = {
  '400': jsonResponse('Invalid input or missing retry key'),
  '401': jsonResponse('Invalid, missing, expired, or revoked credential'),
  '403': jsonResponse('Caller or origin not permitted'),
  '409': jsonResponse('Conflict; reload and reconcile'),
  '503': jsonResponse('Service unavailable; inspect state and preserve retry intent'),
};
const auxiliaryPaths = {
  '/api/v1/state': {
    get: {
      summary: 'Read authorized workspace state',
      security,
      description:
        'Returns {state, actor}; demo returns {state, demo:true}. Use history=none for compact reads. Default retains full authorized audit history. Read requires read or people.read for agents; credential accessMode and People privacy apply.',
      parameters: [
        {
          name: 'history',
          in: 'query',
          schema: { type: 'string', enum: ['none'] },
          description: 'Omit for legacy full-history behavior.',
        },
      ],
      responses: {
        ...errors,
        '200': jsonResponse('Authorized state and actor (or fictional demo)', {
          type: 'object',
          required: ['state'],
          properties: {
            state: { type: 'object' },
            actor: { type: 'object' },
            demo: { type: 'boolean' },
          },
        }),
      },
    },
  },
  '/api/v1/credentials': {
    get: {
      summary: 'List owner-only credential metadata without token hashes',
      security,
      responses: {
        ...errors,
        '200': jsonResponse('Credential metadata', {
          type: 'object',
          required: ['credentials'],
          properties: { credentials: { type: 'array', items: { type: 'object' } } },
        }),
      },
    },
    post: {
      summary: 'Issue an owner-only scoped credential; token returned once',
      security,
      parameters: [retryHeader],
      description:
        'Integrations allow read/evidence.verify; agents allow read, people.read and worker scopes. People mutations require people.read. Task capabilities require assignments unless accessMode is workspace. Workspace access is agent-only, requires empty assignments, and covers current and future work records. Workspace management capabilities require workspace access. workstream.manage additionally permits organizational fields with workstream.update; it is not a command. Default accessMode is assigned. Expiry defaults to 90 days and must be future within 366 days. Equivalent retries do not return the token again.',
      requestBody: jsonBody({
        type: 'object',
        additionalProperties: false,
        required: ['identityId', 'scopes', 'assignments'],
        properties: {
          identityId: idSchema,
          scopes: { type: 'array', minItems: 1, items: { type: 'string' } },
          assignments: { type: 'array', items: idSchema },
          accessMode: { type: 'string', enum: ['assigned', 'workspace'], default: 'assigned' },
          expiresAt: { type: 'string', format: 'date-time' },
        },
      }),
      responses: {
        ...errors,
        '201': jsonResponse('Issuance result; token exists only on initial creation'),
      },
    },
  },
  '/api/v1/credentials/{id}': {
    delete: {
      summary: 'Revoke credential as human owner',
      security,
      parameters: [
        idParameter,
        retryHeader,
        {
          name: 'If-Match',
          in: 'header',
          required: true,
          description: 'Current credential version as a decimal string, without quotes.',
          schema: { type: 'integer', minimum: 1 },
        },
      ],
      responses: { ...errors, '200': jsonResponse('Revocation result') },
    },
  },
  '/api/v1/evidence/upload': {
    post: {
      summary: 'Upload private file evidence, maximum 3 MiB',
      security,
      parameters: [retryHeader],
      description:
        'Requires evidence.attach and access to the parent. Metadata is a JSON-encoded evidence.attach input without storagePath/sha256; server supplies them. File must be nonempty. Let the client set the multipart boundary.',
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file', 'metadata'],
              properties: {
                file: { type: 'string', format: 'binary' },
                metadata: {
                  type: 'string',
                  description:
                    'JSON-encoded evidence.attach input with exactly one parent and its current version.',
                },
              },
            },
          },
        },
      },
      responses: { ...errors, '200': jsonResponse('Attached evidence in {result}') },
    },
  },
  '/api/v1/evidence/{id}/download': {
    get: {
      summary: 'Get a private file URL for authorized evidence',
      security,
      parameters: [idParameter],
      responses: {
        ...errors,
        '404': jsonResponse('File evidence unavailable'),
        '200': jsonResponse('Do not log or persist the signed URL', {
          type: 'object',
          required: ['url', 'expiresIn'],
          properties: {
            url: { type: 'string', format: 'uri' },
            expiresIn: { type: 'integer', const: 60 },
          },
        }),
      },
    },
  },
  '/api/v1/export': {
    post: {
      summary: 'Export owner-selected projects, tasks, or routines',
      security,
      description:
        'Private accord.v3 archive with related evidence and domain audit. Excludes credentials and failed-attempt diagnostics. Project selection includes its tasks; task selection contains only minimal linked People context.',
      requestBody: jsonBody({
        type: 'object',
        additionalProperties: false,
        required: ['ids'],
        properties: { ids: { type: 'array', minItems: 1, items: idSchema } },
      }),
      responses: { ...errors, '200': jsonResponse('Private logical archive; see recovery guide') },
    },
  },
};
const paths = Object.fromEntries(
  Object.entries(schemas).map(([name, schema]) => [
    `/api/v1/commands/${name}`,
    {
      post: {
        operationId: name,
        summary: commandInfo[name as keyof typeof schemas].summary,
        description: `Version target: ${commandInfo[name as keyof typeof schemas].versionTarget}. ${humanOnly.has(name as keyof typeof schemas) ? 'Human only.' : (workspaceCommandScopes as readonly string[]).includes(name) ? 'Requires workspace agent access and the exact command scope, or the human owner.' : 'Requires exact command scope and applicable record access.'} Does not execute external tools. Runtime refinements and field-level authorization also apply.`,
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            schema: { type: 'string', minLength: 8, maxLength: 128, pattern: '^[\\w.-]{8,128}$' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }),
            },
          },
        },
        responses: {
          '200': { description: 'Result committed or equivalent retry replayed' },
          '400': { description: 'Invalid input' },
          '401': { description: 'Invalid or revoked credential' },
          '403': { description: 'Scope, assignment or human-authority restriction' },
          '409': {
            description:
              'Version conflict, exhausted authority, uncertain execution or insufficient evidence',
          },
          '503': {
            description:
              'Persistence unavailable; preserve the intent key and inspect current state before retrying',
          },
        },
      },
    },
  ]),
);
export async function renderOpenApi() {
  return format(
    JSON.stringify({
      openapi: '3.1.0',
      info: {
        title: 'Accord REST API',
        version: '0.1.0',
        description:
          'Tasks use the compatible workstream contract. Bearer authentication and runtime authorization apply. Public docs never grant authority.',
      },
      servers: [{ url: '/' }],
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
      paths: {
        ...paths,
        ...auxiliaryPaths,
        '/api/v1/logs': {
          get: {
            summary: 'Read owner-only activity summaries with keyset pagination',
            security: [{ bearerAuth: [] }],
            parameters: [
              ...['actor', 'command', 'outcome', 'q', 'from', 'to', 'entity', 'cursor'].map(
                (name) => ({ name, in: 'query', schema: { type: 'string' } }),
              ),
              {
                name: 'limit',
                in: 'query',
                schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
              },
            ],
            responses: {
              '200': { description: 'Bounded items and nextCursor; details excluded' },
              '403': { description: 'Workspace owner required' },
            },
          },
        },
        '/api/v1/logs/{id}': {
          get: {
            summary: 'Read one owner-authorized audit or failed-attempt detail',
            security: [{ bearerAuth: [] }],
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string', format: 'uuid' },
              },
            ],
            responses: {
              '200': { description: 'Summary and event or attempt' },
              '403': { description: 'Workspace owner required' },
              '404': { description: 'Event unavailable' },
            },
          },
        },
        '/api/v1/attention': {
          get: {
            summary: 'Read authorized Today and People reminders',
            security: [{ bearerAuth: [] }],
            responses: { '200': { description: 'Current authorized queue' } },
          },
        },
      },
    }),
    { parser: 'json', printWidth: 100 },
  );
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await writeFile('docs/openapi.json', await renderOpenApi());
  console.log('API schemas generated from shared validators.');
}
