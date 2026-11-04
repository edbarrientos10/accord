'use client';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Plus, ArrowUpRight, FolderClosed } from 'lucide-react';
import { useTaskActions } from '../workspace/use-task-actions';
import { FavoriteProjectButton } from '../workspace/project-preferences';
import { Heading, Empty } from '../workspace/ui';
export function Projects() {
  const { state, projectForm } = useTaskActions(),
    params = useSearchParams(),
    router = useRouter(),
    archived = params.get('status') === 'archived',
    projects = state.projects.filter((p) => p.status === (archived ? 'archived' : 'active'));
  return (
    <>
      <Heading
        eyebrow="WORKSPACE"
        title="Projects"
        subtitle="Group related tasks and track progress toward a shared outcome."
        action={
          <button className="button" onClick={() => projectForm()}>
            <Plus size={16} />
            New project
          </button>
        }
      />
      <div className="detail-tabs">
        <button className={!archived ? 'active' : ''} onClick={() => router.replace('/projects')}>
          Active
        </button>
        <button
          className={archived ? 'active' : ''}
          onClick={() => router.replace('/projects?status=archived')}
        >
          Archived
        </button>
      </div>
      <div className="project-grid">
        {projects.map((p, i) => {
          const tasks = state.workstreams.filter((w) => w.projectId === p.id),
            done = tasks.filter((w) => w.status === 'completed').length,
            needs = tasks.filter(
              (w) => w.status === 'blocked' || w.status === 'ready_for_review',
            ).length;
          return (
            <article className="project-card" key={p.id}>
              <div className="row-between">
                <span className={`project-icon project-dot-${i % 3}`}>
                  <FolderClosed size={21} />
                </span>
                <FavoriteProjectButton project={p} />
              </div>
              <Link className="project-card-link" href={`/projects/${p.id}`}>
                <h2>
                  {p.name}
                  <ArrowUpRight size={16} />
                </h2>
              </Link>
              <p>{p.description || 'A space for related tasks.'}</p>
              <div className="project-card-bottom">
                <div className="row-between">
                  <span>
                    {done} / {tasks.length} tasks done
                  </span>
                  <span className="mono">
                    {tasks.length ? Math.round((done / tasks.length) * 100) : 0}%
                  </span>
                </div>
                <progress
                  aria-label={`${p.name} completion`}
                  value={done}
                  max={tasks.length || 1}
                />
                <div className="row-between">
                  <span>{p.targetDate ? `Target ${p.targetDate}` : 'No target date'}</span>
                  <span>{needs ? `${needs} need attention` : 'On track'}</span>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {!projects.length && (
        <Empty
          title={archived ? 'No archived projects' : 'Give your work a home'}
          text="Create a project to bring related tasks into one shared view."
          action={
            !archived && (
              <button className="button secondary" onClick={() => projectForm()}>
                New project
              </button>
            )
          }
        />
      )}
    </>
  );
}
