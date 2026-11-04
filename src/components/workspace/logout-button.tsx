'use client';
import { useWorkspace } from './context';

export function LogoutButton() {
  const { demo, logout, loggingOut } = useWorkspace();
  if (demo) return null;
  return (
    <button
      type="button"
      className="button secondary small"
      disabled={loggingOut}
      onClick={() => void logout()}
    >
      {loggingOut ? 'Logging out…' : 'Log out'}
    </button>
  );
}
