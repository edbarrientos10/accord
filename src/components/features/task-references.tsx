'use client';
import { ArrowUpRight } from 'lucide-react';
import type { Workstream } from '../../domain/types';
import { useActions } from '../workspace/use-actions';
import { fmt, str, reason } from '../workspace/helpers';
export function TaskReferences({ selected }: { selected: Workstream }) {
  const { open, base } = useActions();
  return (
    <>
      {' '}
      <section className="section">
        <div className="section-title">
          <h2>External references</h2>
          <button
            className="button secondary small"
            onClick={() =>
              open(
                'Link an external object',
                'workstream.update',
                [
                  { name: 'system', label: 'Source system' },
                  { name: 'objectId', label: 'External object identifier' },
                  {
                    name: 'responsibility',
                    label: 'Responsibility retained by that system',
                  },
                  { name: 'url', label: 'Link', required: false },
                  {
                    name: 'reportedStatus',
                    label: 'Reported external status',
                    required: false,
                  },
                  reason,
                ],
                (f) => ({
                  ...base(selected, f),
                  references: [
                    ...selected.references,
                    {
                      id: crypto.randomUUID(),
                      system: str(f, 'system'),
                      objectId: str(f, 'objectId'),
                      responsibility: str(f, 'responsibility'),
                      ...(str(f, 'url') ? { url: str(f, 'url') } : {}),
                      ...(str(f, 'reportedStatus')
                        ? { reportedStatus: str(f, 'reportedStatus') }
                        : {}),
                    },
                  ],
                }),
              )
            }
          >
            Link object
          </button>
        </div>
        {selected.references.length ? (
          selected.references.map((r) => (
            <article className="compact-card" key={r.id}>
              <h3>
                {r.system} · {r.objectId}
              </h3>
              <p>{r.responsibility}</p>
              <p className="muted">
                {r.reportedStatus ?? 'No external status reported'} ·{' '}
                {r.checkedAt ? `Checked ${fmt(r.checkedAt)}` : 'Not checked'}
              </p>
              {r.conflict && <p className="error">Conflict: {r.conflict}</p>}
              {r.url && (
                <a className="text-link" href={r.url} rel="noreferrer" target="_blank">
                  Open source <ArrowUpRight size={14} />
                </a>
              )}
              <button
                className="text-link"
                onClick={() =>
                  open(
                    'Check and reconcile external status',
                    'workstream.update',
                    [
                      {
                        name: 'reportedStatus',
                        label: 'Observed external status',
                        value: r.reportedStatus ?? '',
                      },
                      {
                        name: 'conflict',
                        label: 'Unresolved conflict',
                        value: r.conflict ?? '',
                        required: false,
                      },
                      reason,
                    ],
                    (f) => ({
                      ...base(selected, f),
                      references: selected.references.map((x) =>
                        x.id === r.id
                          ? {
                              ...x,
                              reportedStatus: str(f, 'reportedStatus'),
                              checkedAt: new Date().toISOString(),
                              conflict: str(f, 'conflict') || undefined,
                            }
                          : x,
                      ),
                    }),
                  )
                }
              >
                Update status
              </button>
            </article>
          ))
        ) : (
          <p className="muted">
            Specialized systems keep their objects. Accord keeps the coordination.
          </p>
        )}
      </section>
    </>
  );
}
