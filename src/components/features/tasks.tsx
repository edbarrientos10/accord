'use client';
import { FavoriteProjectButton } from '../workspace/project-preferences';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import {
  Plus,
  Search,
  PanelsLeftRight,
  Columns3,
  SlidersHorizontal,
  ArrowUpRight,
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  FolderClosed,
} from 'lucide-react';
import { useTaskActions } from '../workspace/use-task-actions';
import { Heading, Empty, Status, Avatar, stages, taskStage } from '../workspace/ui';
import type { Workstream, Project } from '../../domain/types';
import { TaskDetail } from './task-detail';
export function Tasks({ project }: { project?: Project }) {
  const { state, who, createTask, projectForm, move, pending } = useTaskActions(),
    router = useRouter(),
    pathname = usePathname(),
    params = useSearchParams(),
    search = useRef<HTMLInputElement>(null);
  const view = params.get('view') ?? 'list',
    query = params.get('q') ?? '',
    status = params.get('status') ?? 'active',
    owner = params.get('owner') ?? '',
    priority = params.get('priority') ?? '',
    projectFilter = project?.id ?? params.get('project') ?? '';
  const change = (key: string, value: string) => {
    const p = new URLSearchParams(params.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    // Refiltering starts the review again from the first matching task.
    p.delete('task');
    router.replace(`${pathname}?${p}`, { scroll: false });
  };
  useEffect(() => {
    if (params.get('search')) search.current?.focus();
  }, [params]);
  const tasks = state.workstreams.filter(
    (w) =>
      (!projectFilter || w.projectId === projectFilter) &&
      (!owner || w.ownerId === owner) &&
      (!priority || (w.priority ?? 'none') === priority) &&
      `${w.title} ${w.outcome} ${who(w.ownerId)}`.toLowerCase().includes(query.toLowerCase()) &&
      (status === 'all' ||
        (status === 'active'
          ? !['completed', 'cancelled', 'dismissed'].includes(w.status)
          : taskStage(w) === status)),
  );
  const requested = params.get('task'),
    // An explicitly opened task stays open even after an edit filters it out of the list.
    explicit = state.workstreams.find((w) => w.id === requested),
    missing = !!requested && !explicit,
    selected = missing ? undefined : (explicit ?? tasks[0]),
    index = selected ? tasks.indexOf(selected) : -1;
  const openTask = (w: Workstream, replace = false) => {
    const p = new URLSearchParams(params.toString());
    p.set('task', w.id);
    p.delete('view');
    router[replace ? 'replace' : 'push'](`${pathname}?${p}`, { scroll: false });
  };
  const closeTask = () => {
    const p = new URLSearchParams(params.toString());
    p.delete('task');
    router.push(`${pathname}?${p}`, { scroll: false });
  };
  const step = (offset: number, focus = false) => {
    const next = tasks[index + offset];
    if (!next) return;
    openTask(next, true);
    const row = document.querySelector<HTMLButtonElement>(`[data-task-row="${next.id}"]`);
    row?.scrollIntoView({ block: 'nearest' });
    if (focus) row?.focus();
  };
  const listKeys = (e: KeyboardEvent) => {
    const offset = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 }[e.key];
    if (!offset || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    step(offset, true);
  };
  const due = (date: string) =>
    new Date(date + 'T12:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' });
  const finished = project
      ? state.workstreams.filter((w) => w.projectId === project.id && w.status === 'completed')
          .length
      : 0,
    total = project ? state.workstreams.filter((w) => w.projectId === project.id).length : 0;
  return (
    <div className="tasks-page">
      <Heading
        eyebrow={project ? 'PROJECT' : 'WORKSPACE'}
        title={project?.name ?? 'Tasks'}
        subtitle={project?.description}
        action={
          <div className="button-row">
            {project && <FavoriteProjectButton project={project} />}
            {project && (
              <button className="button secondary" onClick={() => projectForm(project)}>
                Edit project
              </button>
            )}
            <button className="button" onClick={() => createTask(project?.id)}>
              <Plus size={16} />
              New task
            </button>
          </div>
        }
      />
      {project && (
        <div className="project-summary">
          <span className={`badge ${project.status === 'archived' ? '' : 'blue'}`}>
            {project.status}
          </span>
          <span>
            {finished} of {total} completed
          </span>
          <progress aria-label="Project completion" value={finished} max={total || 1} />
          <span>{project.targetDate ? `Target ${project.targetDate}` : 'No target date'}</span>
        </div>
      )}
      <div className="view-toolbar tasks-toolbar">
        <label className="task-search">
          <Search size={17} />
          <input
            ref={search}
            aria-label="Search tasks"
            placeholder="Search tasks…"
            value={query}
            onChange={(e) => change('q', e.target.value)}
          />
        </label>
        <div className="filter-bar">
          <SlidersHorizontal size={15} />
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => change('status', e.target.value)}
          >
            <option value="active">Active tasks</option>
            <option value="all">All statuses</option>
            {stages.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
            <option value="cancelled">Cancelled</option>
            <option value="dismissed">Dismissed</option>
          </select>
          <select
            aria-label="Filter by owner"
            value={owner}
            onChange={(e) => change('owner', e.target.value)}
          >
            <option value="">All owners</option>
            {state.identities
              .filter((i) => ['human', 'agent'].includes(i.kind))
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
          </select>
          <select
            aria-label="Filter by priority"
            value={priority}
            onChange={(e) => change('priority', e.target.value)}
          >
            <option value="">All priorities</option>
            {['urgent', 'high', 'medium', 'low', 'none'].map((p) => (
              <option key={p} value={p}>
                {p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
          {!project && (
            <select
              aria-label="Filter by project"
              value={projectFilter}
              onChange={(e) => change('project', e.target.value)}
            >
              <option value="">All projects</option>
              {state.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <span className="results-count">
          {tasks.length} task{tasks.length === 1 ? '' : 's'}
        </span>
        <div className="view-toggle" aria-label="Task view">
          <button
            className={view === 'list' ? 'selected' : ''}
            aria-pressed={view === 'list'}
            aria-label="Review view"
            onClick={() => change('view', '')}
          >
            <PanelsLeftRight size={16} />
            Review
          </button>
          <button
            className={view === 'board' ? 'selected' : ''}
            aria-pressed={view === 'board'}
            aria-label="Board view"
            onClick={() => change('view', 'board')}
          >
            <Columns3 size={16} />
            Board
          </button>
        </div>
      </div>
      {!tasks.length && (view === 'board' || !explicit) ? (
        <Empty
          title="A little room to make progress"
          text="Create a task or adjust your filters to find the work you’re looking for."
          action={
            <button className="button secondary" onClick={() => createTask(project?.id)}>
              New task
            </button>
          }
        />
      ) : view === 'board' ? (
        <div className="task-board">
          {[
            ...stages,
            ...['cancelled', 'dismissed']
              .filter((value) => status === value || tasks.some((w) => w.status === value))
              .map((value) => ({
                value,
                label: value[0].toUpperCase() + value.slice(1),
                icon: FolderClosed,
              })),
          ].map((stage) => (
            <section
              className="board-column"
              key={stage.value}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const w = tasks.find((w) => w.id === e.dataTransfer.getData('text/plain'));
                if (w && !pending) move(w, stage.value);
              }}
            >
              <h2>
                <stage.icon size={16} />
                {stage.label}
                <span>{tasks.filter((w) => taskStage(w) === stage.value).length}</span>
              </h2>
              {tasks
                .filter((w) => taskStage(w) === stage.value)
                .map((w) => (
                  <article
                    className="board-card"
                    key={w.id}
                    draggable={!pending}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', w.id)}
                  >
                    <button className="board-title" onClick={() => openTask(w)}>
                      {w.title}
                    </button>
                    <p>{state.projects.find((p) => p.id === w.projectId)?.name ?? 'No project'}</p>
                    <div className="row-between">
                      <span className={`priority priority-${w.priority ?? 'none'}`}>
                        {w.priority ?? 'none'}
                      </span>
                      <Avatar
                        name={who(w.ownerId)}
                        agent={state.identities.find((i) => i.id === w.ownerId)?.kind === 'agent'}
                      />
                    </div>
                    <select
                      aria-label={`Move ${w.title}`}
                      value={taskStage(w)}
                      disabled={pending}
                      onChange={(e) => move(w, e.target.value)}
                    >
                      {stages.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </article>
                ))}
            </section>
          ))}
        </div>
      ) : (
        <div className="record-review" data-explicit={explicit || missing ? 'true' : undefined}>
          <nav className="review-list" aria-label="Tasks">
            <ul onKeyDown={listKeys}>
              {tasks.map((w) => (
                <li
                  key={w.id}
                  className="review-row"
                  aria-current={w.id === selected?.id ? 'true' : undefined}
                >
                  <button
                    className="review-row-title"
                    data-task-row={w.id}
                    onClick={() => openTask(w)}
                  >
                    {w.title}
                  </button>
                  <span className="review-row-meta">
                    <Status task={w} />
                    <span className={`priority priority-${w.priority ?? 'none'}`}>
                      {w.priority ?? 'none'}
                    </span>
                    {w.dueDate && <span className="mono">{due(w.dueDate)}</span>}
                    <Avatar
                      name={who(w.ownerId)}
                      agent={state.identities.find((i) => i.id === w.ownerId)?.kind === 'agent'}
                    />
                  </span>
                  {!project && (
                    <span className="review-row-project">
                      {state.projects.find((p) => p.id === w.projectId)?.name ?? 'No project'}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {!tasks.length && <p className="review-list-empty">No tasks match these filters.</p>}
          </nav>
          <section
            className="review-detail"
            aria-label={selected ? `Task: ${selected.title}` : 'Task unavailable'}
          >
            <div className="review-bar">
              <button className="review-back button secondary small" onClick={closeTask}>
                <ArrowLeft size={15} />
                Back to tasks
              </button>
              {selected && (
                <>
                  <div className="review-stepper">
                    <button
                      className="icon-button"
                      aria-label="Previous task"
                      disabled={index <= 0}
                      onClick={() => step(-1)}
                    >
                      <ChevronUp size={18} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Next task"
                      disabled={index >= tasks.length - 1}
                      onClick={() => step(1)}
                    >
                      <ChevronDown size={18} />
                    </button>
                    {index >= 0 && (
                      <span className="mono">
                        {index + 1} of {tasks.length}
                      </span>
                    )}
                  </div>
                  <Link
                    href={`/tasks/${selected.id}`}
                    aria-label="Open task full page"
                    className="icon-button"
                  >
                    <ArrowUpRight size={18} />
                  </Link>
                </>
              )}
            </div>
            {selected ? (
              <TaskDetail key={selected.id} task={selected} panel />
            ) : (
              <Empty
                title="Task unavailable"
                text="This task may no longer be accessible."
                action={
                  <button className="button secondary" onClick={closeTask}>
                    Back to tasks
                  </button>
                }
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
