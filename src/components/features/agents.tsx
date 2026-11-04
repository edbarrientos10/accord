'use client';
import Link from 'next/link';
import { useWorkspace } from '../workspace/context';
import { useActions } from '../workspace/use-actions';
import { auth, fmt, datetime, iso, str, reason } from '../workspace/helpers';
import { workspaceAgentScopes, agentScopes } from '../../domain/permissions';
import { Empty, Heading } from '../workspace/ui';
export function Agents() {
  const { state, demo, setNotice, setForm, request, reload, credentials, newToken, setNewToken } =
    useWorkspace();
  const { open, people, who } = useActions();
  return (
    <>
      <Heading
        title="Agents"
        subtitle="Give every collaborator a clear identity and bounded access."
      />{' '}
      <section className="section">
        <div className="section-title">
          <h2>Agents & integrations</h2>
          <button
            className="button secondary small"
            onClick={() =>
              open(
                'Add an identity',
                'identity.create',
                [
                  { name: 'name', label: 'Display name' },
                  {
                    name: 'kind',
                    label: 'Identity type',
                    type: 'select',
                    options: [
                      { value: 'agent', label: 'Agent' },
                      { value: 'integration', label: 'Independent verifier integration' },
                    ],
                  },
                  reason,
                ],
                (f) => ({
                  name: str(f, 'name'),
                  kind: str(f, 'kind'),
                  reason: str(f, 'reason'),
                }),
              )
            }
          >
            Add identity
          </button>
        </div>
        {state.identities
          .filter((i) => i.kind !== 'third_party')
          .map((i) => (
            <div className="identity-row" key={i.id}>
              <span className="avatar light">{i.name.charAt(0)}</span>
              <div>
                <strong>{i.name}</strong>
                <p className="muted">{i.kind.replace('_', ' ')}</p>
                <Link className="text-link" href={`/logs?actor=${i.id}`}>
                  View activity
                </Link>
              </div>
            </div>
          ))}
      </section>
      <section className="section">
        <div className="section-title">
          <h2>Agent credentials</h2>
          <button
            className="button secondary small"
            onClick={() => {
              if (demo) {
                setNotice('Credential issuance is available in your installed workspace.');
                return;
              }
              const credentialKey = crypto.randomUUID();
              setForm({
                title: 'Issue scoped credential',
                description:
                  'Selected-record tokens require task assignments. Entire workspace covers current and future work records. People access and management capabilities must be selected explicitly. Save the token when displayed; Accord stores only its hash.',
                fields: [
                  {
                    name: 'identityId',
                    label: 'Agent or integration',
                    type: 'select',
                    options: people(['agent', 'integration']),
                  },
                  {
                    name: 'accessMode',
                    label: 'Record access',
                    type: 'select',
                    value: 'assigned',
                    options: [
                      { value: 'assigned', label: 'Selected records' },
                      { value: 'workspace', label: 'Entire workspace' },
                    ],
                    hint: 'Entire workspace is available to agents only and includes future records.',
                  },
                  {
                    name: 'scopes',
                    label: 'Allowed capabilities',
                    type: 'multiselect',
                    value: ['read'],
                    options: ['read', 'people.read', ...agentScopes, 'evidence.verify'].map(
                      (v) => ({
                        value: v,
                        label: v,
                      }),
                    ),
                  },
                  {
                    name: 'managementScopes',
                    label: 'Workspace management capabilities',
                    type: 'multiselect',
                    required: false,
                    when: { field: 'accessMode', value: 'workspace' },
                    options: workspaceAgentScopes.map((value) => ({ value, label: value })),
                    hint: 'Select each management capability you want to delegate. workstream.manage also requires workstream.update.',
                  },
                  {
                    name: 'assignments',
                    label: 'Assigned records',
                    disabledWhen: { field: 'accessMode', value: 'workspace' },
                    required: false,
                    type: 'multiselect',
                    options: [...state.workstreams, ...state.operations].map((w) => ({
                      value: w.id,
                      label: w.title,
                    })),
                  },
                  {
                    name: 'expiresAt',
                    label: 'Expires at',
                    type: 'datetime-local',
                    value: datetime(new Date(Date.now() + 90 * 86400000).toISOString()),
                  },
                ],
                submit: 'Issue token',
                run: async (f) => {
                  const d = await request('/api/v1/credentials', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Idempotency-Key': credentialKey,
                    },
                    body: JSON.stringify({
                      identityId: str(f, 'identityId'),
                      scopes: [...f.getAll('scopes'), ...f.getAll('managementScopes')],
                      assignments:
                        str(f, 'accessMode') === 'workspace' ? [] : f.getAll('assignments'),
                      accessMode: str(f, 'accessMode'),
                      expiresAt: iso(f, 'expiresAt'),
                    }),
                  });
                  setNewToken(d.token ?? '');
                  setNotice(d.message);
                  await reload();
                },
              });
            }}
          >
            Issue token
          </button>
        </div>
        {newToken && (
          <div className="token-panel">
            <strong>Save this token now. It will not be shown again.</strong>
            <code>{newToken}</code>
            <button
              className="button secondary small"
              onClick={() => {
                setNewToken('');
              }}
            >
              I saved it · hide token
            </button>
          </div>
        )}
        {credentials.length ? (
          credentials.map((c) => (
            <article className="compact-card" key={c.id}>
              <div className="row-between">
                <strong>{who(c.identity_id)}</strong>
                <span className="badge">
                  {c.revoked_at ? 'Revoked' : `Expires ${fmt(c.expires_at)}`}
                </span>
              </div>
              <p>
                {c.access_mode === 'workspace'
                  ? 'Entire workspace · includes future records'
                  : 'Selected records'}
              </p>
              <p className="muted">{c.scopes.join(', ')}</p>
              <p>
                {c.assignments
                  .map(
                    (id) =>
                      [...state.workstreams, ...state.operations].find((w) => w.id === id)?.title ??
                      id,
                  )
                  .join(', ')}
              </p>
              {!c.revoked_at && (
                <button
                  className="button secondary small"
                  onClick={async () => {
                    try {
                      await request(`/api/v1/credentials/${c.id}`, {
                        method: 'DELETE',
                        headers: {
                          'If-Match': String(c.version),
                          'Idempotency-Key': crypto.randomUUID(),
                        },
                      });
                      await reload();
                    } catch (e) {
                      setNotice((e as Error).message);
                    }
                  }}
                >
                  Revoke access
                </button>
              )}
            </article>
          ))
        ) : (
          <Empty
            title="No credentials issued"
            text="Connect a generic MCP client to /mcp with a scoped bearer token."
          />
        )}
      </section>
    </>
  );
}
