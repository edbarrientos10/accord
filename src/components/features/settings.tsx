'use client';
import { useState } from 'react';
import { useActions } from '../workspace/use-actions';
import { useWorkspace } from '../workspace/context';
import { auth, str } from '../workspace/helpers';
import { Heading } from '../workspace/ui';
import { LogoutButton } from '../workspace/logout-button';
import { ThemeSetting } from '../theme-provider';
export function Settings() {
  const { state, demo, setNotice, setForm, request } = useWorkspace();
  const { open } = useActions();
  return (
    <>
      <Heading
        title="Workspace settings"
        subtitle="Your profile, appearance, security, private exports, and recovery."
      />{' '}
      <Profile />
      <ThemeSetting />
      <section className="section">
        <h2>Calendar timezone</h2>
        <p className="muted">Calendar dates and relationship reminders use {state.timezone}.</p>
        <button
          className="button secondary small"
          onClick={() =>
            open(
              'Change workspace timezone',
              'workspace.timezone',
              [{ name: 'timezone', label: 'IANA timezone', value: state.timezone }],
              (f) => ({
                timezone: str(f, 'timezone'),
                expectedVersion: state.revision,
                reason: 'Changed calendar timezone',
              }),
              undefined,
              'Save timezone',
            )
          }
        >
          Change timezone
        </button>
      </section>
      <section className="section">
        <h2>Security & recovery</h2>
        <p className="muted">
          Exports contain private data. Choose the records to include; credentials are excluded.
        </p>
        <div className="button-row">
          <button
            className="button secondary small"
            onClick={() => {
              if (demo) {
                setNotice('The preview has no private data to export.');
                return;
              }
              setForm({
                title: 'Export coordination records',
                description:
                  'Evidence files are included. Treat the downloaded archive as private.',
                fields: [
                  {
                    name: 'assignments',
                    label: 'Records to export',
                    type: 'multiselect',
                    options: [
                      ...state.projects.map((p) => ({ id: p.id, title: 'Project: ' + p.name })),
                      ...state.workstreams,
                      ...state.operations,
                    ].map((w) => ({
                      value: w.id,
                      label: w.title,
                    })),
                  },
                ],
                submit: 'Export selected records',
                run: async (f) => {
                  const d = await request('/api/v1/export', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: f.getAll('assignments') }),
                  });
                  const blob = new Blob([JSON.stringify(d, null, 2)], {
                      type: 'application/json',
                    }),
                    url = URL.createObjectURL(blob),
                    a = document.createElement('a');
                  a.href = url;
                  a.download = 'accord-export.json';
                  a.click();
                  URL.revokeObjectURL(url);
                },
              });
            }}
          >
            Export selected records
          </button>
          <button
            className="button secondary small"
            onClick={() => {
              if (demo) return;
              setForm({
                title: 'Enable two-factor authentication',
                fields: [],
                submit: 'Set up authenticator',
                run: async () => {
                  const { data, error } = await auth().auth.mfa.enroll({
                    factorType: 'totp',
                    friendlyName: `Accord ${new Date().toISOString()}`,
                  });
                  if (error) throw error;
                  const factorId = data.id;
                  setTimeout(
                    () =>
                      setForm({
                        title: 'Verify authenticator',
                        description: `Add this secret to your authenticator app, then enter its six-digit code:\n${data.totp.secret}`,
                        fields: [{ name: 'code', label: 'Authenticator code' }],
                        submit: 'Verify and enable',
                        run: async (f) => {
                          const { error } = await auth().auth.mfa.challengeAndVerify({
                            factorId,
                            code: str(f, 'code'),
                          });
                          if (error) throw error;
                          setNotice('Two-factor authentication enabled.');
                        },
                      }),
                    0,
                  );
                },
              });
            }}
          >
            Enable TOTP
          </button>
        </div>
      </section>
      {!demo && (
        <section className="section">
          <h2>Account</h2>
          <LogoutButton />
        </section>
      )}
    </>
  );
}

function Profile() {
  const { state, demo, run } = useWorkspace();
  const owner = state.identities.find((i) => i.kind === 'human')!;
  const [name, setName] = useState(owner.name === 'Workspace owner' ? '' : owner.name);
  const [role, setRole] = useState(owner.role ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  return (
    <section className="section" id="your-profile">
      <h2>Your profile</h2>
      <p className="muted">Choose how you appear in your workspace.</p>
      <form
        className="profile-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (saving || demo) return;
          setSaving(true);
          setError('');
          try {
            await run(
              'profile.update',
              { name, role, expectedVersion: state.revision, reason: 'Updated personal profile' },
              true,
            );
            setName(name.trim());
            setRole(role.trim());
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <label>
          Display name
          <input
            name="name"
            autoComplete="name"
            required
            maxLength={100}
            value={name}
            disabled={demo || saving}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          <span>
            Role/title <span className="muted">(optional)</span>
          </span>
          <input
            name="role"
            autoComplete="organization-title"
            maxLength={100}
            value={role}
            disabled={demo || saving}
            onChange={(e) => setRole(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="button primary small" disabled={demo || saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </form>
    </section>
  );
}
