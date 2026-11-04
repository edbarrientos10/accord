'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { auth, str } from '../workspace/helpers';
import { BrandLogo } from '../brand-logo';
export function Login({
  error,
  onLogin,
  reset,
}: {
  error: string;
  onLogin: (token: string) => Promise<void>;
  reset: boolean;
}) {
  const [message, setMessage] = useState(error),
    [busy, setBusy] = useState(false),
    [factor, setFactor] = useState('');
  useEffect(() => {
    if (!reset) return;
    let active = true;
    async function recoveryFactors() {
      try {
        const client = auth();
        const [{ data: factors }, { data: assurance }] = await Promise.all([
          client.auth.mfa.listFactors(),
          client.auth.mfa.getAuthenticatorAssuranceLevel(),
        ]);
        if (active && factors?.totp.length && assurance?.currentLevel !== 'aal2')
          setFactor(factors.totp[0].id);
      } catch {}
    }
    void recoveryFactors();
    return () => {
      active = false;
    };
  }, [reset]);
  return (
    <main className="login-page">
      <div className="login-story">
        <span className="wordmark">
          <BrandLogo />
        </span>
        <span className="eyebrow">SHARED WORK, CLEARLY HELD</span>
        <h1>
          A clear path for
          <br />
          your work.
          <br />
          <em>And what’s next.</em>
        </h1>
        <p>
          Your projects. Your agents. Your decisions.
          <br />A clear next step.
        </p>
      </div>
      <div className="login-form">
        <span className="eyebrow">YOUR PRIVATE WORKSPACE</span>
        <h2>
          {factor ? 'Verify your identity' : reset ? 'Reset your password' : 'Welcome to Accord'}
        </h2>
        <p className="muted">
          {reset
            ? 'Choose a new password for your installed owner account.'
            : 'Sign in with the owner account created during installation.'}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage('');
            const f = new FormData(e.currentTarget);
            try {
              if (factor) {
                const { data, error } = await auth().auth.mfa.challengeAndVerify({
                  factorId: factor,
                  code: str(f, 'code'),
                });
                if (error) throw error;
                await onLogin(data.access_token);
                if (reset) {
                  setFactor('');
                  setMessage('Identity verified. Choose your new password.');
                }
                return;
              }
              if (reset) {
                const { error } = await auth().auth.updateUser({ password: str(f, 'password') });
                if (error) throw error;
                setMessage('Password updated. Return to the workspace.');
                return;
              }
              const { data, error } = await auth().auth.signInWithPassword({
                email: str(f, 'email'),
                password: str(f, 'password'),
              });
              if (error) throw error;
              const { data: factors } = await auth().auth.mfa.listFactors();
              if (factors?.totp.length) {
                setFactor(factors.totp[0].id);
                return;
              }
              await onLogin(data.session.access_token);
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {factor ? (
            <label>
              Authenticator code
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                pattern="[0-9]{6}"
              />
            </label>
          ) : (
            <>
              {!reset && (
                <label>
                  Email
                  <input name="email" type="email" autoComplete="username" required />
                </label>
              )}
              <label>
                {reset ? 'New password' : 'Password'}
                <input
                  name="password"
                  type="password"
                  autoComplete={reset ? 'new-password' : 'current-password'}
                  required
                  minLength={reset ? 12 : undefined}
                />
              </label>
            </>
          )}
          <button className="button" disabled={busy}>
            {busy
              ? 'Signing in…'
              : factor
                ? 'Verify'
                : reset
                  ? 'Update password'
                  : 'Open workspace'}
            <ArrowUpRight size={16} />
          </button>
          {!reset && !factor && (
            <button
              className="text-link"
              type="button"
              onClick={async (e) => {
                const email = str(new FormData(e.currentTarget.form!), 'email');
                if (!email) {
                  setMessage('Enter your email address first.');
                  return;
                }
                try {
                  const { error } = await auth().auth.resetPasswordForEmail(email, {
                    redirectTo: `${window.location.origin}/reset-password`,
                  });
                  if (error) throw error;
                  setMessage('If this owner account exists, a recovery email has been sent.');
                } catch (e) {
                  setMessage((e as Error).message);
                }
              }}
            >
              Recover password
            </button>
          )}
          {reset && (
            <Link className="text-link" href="/">
              Return to workspace
            </Link>
          )}
        </form>
        {message && (
          <p className="error" role="alert">
            {message}
          </p>
        )}
        <p className="installation-note">
          New installation? Create the owner with <code>npm run bootstrap</code>. Public signup is
          disabled. <a href="/help/install.html">Installation help</a> ·{' '}
          <a href="/help/user-guide.html">User guide</a>
        </p>
      </div>
    </main>
  );
}
