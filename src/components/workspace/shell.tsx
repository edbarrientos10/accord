'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Users,
  ListTree,
  Inbox,
  CheckSquare2,
  FolderClosed,
  Repeat2,
  Bot,
  Settings,
  BookOpen,
  Plus,
  PanelLeft,
  RefreshCw,
  ArrowUpRight,
  Search,
  X,
  ChevronDown,
} from 'lucide-react';
import { useWorkspace } from './context';
import { useTaskActions } from './use-task-actions';
import { decisionQueue, filterTodayQueue } from '../../domain/presentation';
import { useProjectPreferences } from './project-preferences';
import { LogoutButton } from './logout-button';
import { Avatar } from './ui';
import { BrandLogo } from '../brand-logo';
const links = [
  { href: '/', label: 'Today', icon: Inbox },
  { href: '/tasks', label: 'Tasks', icon: CheckSquare2 },
  { href: '/projects', label: 'Projects', icon: FolderClosed },
  { href: '/people', label: 'People', icon: Users },
  { href: '/routines', label: 'Routines', icon: Repeat2 },
  { href: '/agents', label: 'Agents', icon: Bot },
  { href: '/logs', label: 'Logs', icon: ListTree },
];
export function Shell({ children }: { children: ReactNode }) {
  const c = useWorkspace(),
    { createTask } = useTaskActions(),
    pathname = usePathname(),
    menu = useRef<HTMLDialogElement>(null);
  const { favorites, collapsed, ready, toggleCollapsed } = useProjectPreferences();
  const favoriteProjects = c.state.projects.filter(
    (p) => p.status === 'active' && favorites.includes(p.id),
  );
  const human = c.state.identities.find((i) => i.kind === 'human');
  const count = filterTodayQueue(decisionQueue(c.state), c.state, 'needs-me').length;
  useEffect(() => {
    menu.current?.close();
  }, [pathname]);
  const nav = (
    <>
      <Link className="wordmark" href="/">
        <BrandLogo />
      </Link>
      <button
        className="sidebar-create"
        onClick={() => {
          menu.current?.close();
          createTask();
        }}
      >
        <Plus size={17} />
        New task<span>＋</span>
      </button>
      <span className="nav-label">WORKSPACE</span>
      <nav aria-label="Main navigation">
        {links.map((n) => (
          <Link
            key={n.href}
            aria-current={
              (n.href === '/' ? pathname === '/' : pathname.startsWith(n.href)) ? 'page' : undefined
            }
            href={n.href}
          >
            <n.icon size={18} />
            {n.label}
            {n.href === '/' && count > 0 && <span className="nav-count">{count}</span>}
          </Link>
        ))}
      </nav>
      <section className="sidebar-projects" aria-label="Favorite projects">
        <button
          className="favorites-toggle"
          type="button"
          aria-expanded={!collapsed}
          disabled={!ready}
          onClick={toggleCollapsed}
        >
          <ChevronDown size={14} />
          <span>FAVORITES</span>
          <span className="favorites-count">{favoriteProjects.length}</span>
        </button>
        {!collapsed && (
          <>
            {favoriteProjects.map((p, i) => (
              <Link
                href={`/projects/${p.id}`}
                key={p.id}
                aria-current={pathname === `/projects/${p.id}` ? 'page' : undefined}
              >
                <span className={`project-dot project-dot-${i % 3}`} />
                {p.name}
              </Link>
            ))}
            {!favoriteProjects.length && (
              <p className="favorites-empty">Star projects to keep them here.</p>
            )}
            <Link className="favorites-browse" href="/projects">
              Browse projects
            </Link>
          </>
        )}
      </section>
      <div className="sidebar-bottom">
        <a className="settings-link" href="/help/index.html">
          <BookOpen size={18} />
          Help & guides
        </a>
        <Link className="settings-link" href="/settings">
          <Settings size={18} />
          Settings
        </Link>
        <Link className="workspace-indicator" href="/settings#your-profile">
          <Avatar name={human?.name ?? 'Owner'} />
          <div>
            <strong>{human?.name ?? 'Workspace owner'}</strong>
            <small>{c.demo ? 'Fictional preview' : 'Private workspace'}</small>
          </div>
          <span className="sr-only">Edit your profile</span>
          <ArrowUpRight size={15} />
        </Link>
      </div>
    </>
  );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">{nav}</aside>
      <dialog ref={menu} className="mobile-navigation" aria-label="Navigation">
        <button
          className="mobile-close icon-button"
          aria-label="Close navigation"
          onClick={() => menu.current?.close()}
        >
          <X size={20} />
        </button>
        {nav}
      </dialog>
      <div
        className={`main-shell${pathname === '/' ? ' today-shell' : ''}${pathname === '/tasks' ? ' tasks-shell' : ''}`}
      >
        <header className="topbar">
          <div className="topbar-location">
            <button
              className="icon-button mobile-menu"
              aria-label="Toggle navigation"
              onClick={() => menu.current?.showModal()}
            >
              <PanelLeft size={20} />
            </button>
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>
              {links.find((n) => (n.href === '/' ? pathname === '/' : pathname.startsWith(n.href)))
                ?.label ?? (pathname === '/settings' ? 'Settings' : 'Task')}
            </strong>
          </div>
          <div className="topbar-actions">
            <Link className="topbar-search" href="/tasks?search=1">
              <Search size={16} />
              <span>Find a task</span>
            </Link>
            <span className="private-indicator">
              <span />
              {c.demo ? 'Preview' : 'Private'}
            </span>
            <button
              className="icon-button"
              aria-label="Refresh workspace"
              onClick={() =>
                void c.reload().catch((e) => {
                  if (e.name !== 'AbortError') c.setNotice(e.message);
                })
              }
            >
              <RefreshCw size={16} />
            </button>
            <LogoutButton />
          </div>
        </header>
        <main id="main" className="main-content">
          {c.demo && (
            <div className="demo-banner">
              <span className="preview-dot" />
              Fictional, read-only preview
              <span className="demo-detail">Explore the workspace. No services are connected.</span>
            </div>
          )}
          <ProfilePrompt />
          {c.error && (
            <p role="alert" className="error">
              {c.error}
            </p>
          )}
          {children}
        </main>
        {c.notice && (
          <div className="toast" role="status">
            {c.notice}
            <button
              aria-label="Dismiss notification"
              className="icon-button"
              onClick={() => c.setNotice('')}
            >
              <X size={17} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ProfilePrompt() {
  const { state, demo } = useWorkspace();
  const [dismissed, setDismissed] = useState(true);
  const key = `accord:profile-prompt:v1:${state.workspaceId}`;
  const owner = state.identities.find((i) => i.kind === 'human');
  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(key) === 'dismissed');
    } catch {
      setDismissed(false);
    }
  }, [key]);
  if (demo || dismissed || (owner?.name.trim() && owner.name.trim() !== 'Workspace owner'))
    return null;
  return (
    <section className="profile-prompt" aria-label="Profile setup">
      <div>
        <strong>Make this workspace yours</strong>
        <p className="muted">Add your name and an optional role.</p>
      </div>
      <div className="button-row">
        <Link className="button secondary small" href="/settings#your-profile">
          Set up profile
        </Link>
        <button
          type="button"
          className="button secondary small"
          onClick={() => {
            setDismissed(true);
            try {
              sessionStorage.setItem(key, 'dismissed');
            } catch {}
          }}
        >
          Not now
        </button>
      </div>
    </section>
  );
}
