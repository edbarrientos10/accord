'use client';
import type { ReactNode } from 'react';
import { WorkspaceProvider } from './context';
import { Shell } from './shell';

// The root layout retains this frame when the catch-all page changes sections.
export function WorkspaceFrame({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <Shell>{children}</Shell>
    </WorkspaceProvider>
  );
}
