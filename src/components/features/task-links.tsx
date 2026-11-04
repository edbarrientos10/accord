'use client';
import { useId } from 'react';
import { ArrowUpRight, Plus } from 'lucide-react';
import type { TaskLink, Workstream } from '../../domain/types';
import { taskLinkSchema } from '../../domain/task-links';
import { useActions } from '../workspace/use-actions';
import { useWorkspace } from '../workspace/context';
import { str } from '../workspace/helpers';

export function TaskLinks({ task }: { task: Workstream }) {
  const { open } = useActions(),
    { pending } = useWorkspace(),
    headingId = useId(),
    links = task.links ?? [],
    closed = ['completed', 'cancelled', 'dismissed'].includes(task.status);
  const edit = (link?: TaskLink) =>
    open(
      link ? 'Edit task link' : 'Add task link',
      'workstream.update',
      [
        { name: 'title', label: 'Title', value: link?.title },
        { name: 'url', label: 'URL', value: link?.url, hint: 'Use an HTTP or HTTPS URL.' },
        { name: 'note', label: 'Note', type: 'textarea', value: link?.note, required: false },
      ],
      (f) => {
        const parsed = taskLinkSchema.safeParse({
          id: link?.id ?? crypto.randomUUID(),
          title: str(f, 'title'),
          url: str(f, 'url'),
          ...(str(f, 'note').trim() ? { note: str(f, 'note') } : {}),
        });
        if (!parsed.success) throw new Error(parsed.error.issues[0].message);
        return {
          entityId: task.id,
          expectedVersion: task.version,
          links: link
            ? links.map((item) => (item.id === link.id ? parsed.data : item))
            : [...links, parsed.data],
          reason: link ? 'Edited task link' : 'Added task link',
        };
      },
      undefined,
      link ? 'Save link' : 'Add link',
    );
  return (
    <section className="section task-links" aria-labelledby={headingId}>
      <div className="section-title">
        <h2 id={headingId}>Links</h2>
        {!closed && (
          <button className="button secondary small" disabled={pending} onClick={() => edit()}>
            <Plus size={14} aria-hidden />
            Add link
          </button>
        )}
      </div>
      {links.length ? (
        links.map((link) => (
          <article className="compact-card" key={link.id} aria-label={link.title}>
            <h3>
              <a
                className="text-link task-link-title"
                href={link.url}
                target="_blank"
                rel="noreferrer"
              >
                <span>{link.title}</span>
                <ArrowUpRight size={14} aria-hidden />
              </a>
            </h3>
            <p className="muted">{link.url}</p>
            {link.note && <p className="task-link-note">{link.note}</p>}
            {!closed && (
              <div className="button-row">
                <button className="text-link" disabled={pending} onClick={() => edit(link)}>
                  Edit
                </button>
                <button
                  className="text-link"
                  disabled={pending}
                  onClick={() =>
                    open(
                      'Remove task link',
                      'workstream.update',
                      [],
                      () => ({
                        entityId: task.id,
                        expectedVersion: task.version,
                        links: links.filter((item) => item.id !== link.id),
                        reason: 'Removed task link',
                      }),
                      `Remove “${link.title}” from this task?`,
                      'Remove link',
                    )
                  }
                >
                  Remove
                </button>
              </div>
            )}
          </article>
        ))
      ) : (
        <p className="muted">No links yet. Add documents, deliverables, or useful resources.</p>
      )}
    </section>
  );
}
