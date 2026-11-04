'use client';
import Link from 'next/link';
import { useWorkspace } from './context';
import { useLogPage } from './use-log-page';
import { Empty } from './ui';
export function RecordActivity({ entityId }: { entityId: string }) {
  const { state } = useWorkspace();
  const query = new URLSearchParams({
    actor: 'all',
    entity: entityId,
    limit: '10',
    revision: String(state.revision),
  }).toString();
  const { page, loading, error } = useLogPage(query);
  return (
    <>
      {error && (
        <p role="alert" className="error">
          History could not be loaded. {error}
        </p>
      )}
      {page.items.length ? (
        <ol className="timeline">
          {page.items.map((a) => (
            <li key={a.id}>
              <span className="timeline-dot" />
              <div>
                <strong>{a.command.replaceAll('.', ' · ').replaceAll('_', ' ')}</strong>
                <p>{a.reason}</p>
                <small>
                  {a.actorName} ·{' '}
                  {new Date(a.at).toLocaleString('en', { timeZone: state.timezone })}
                </small>
                <p>
                  <Link
                    className="text-link"
                    href={`/logs?actor=all&entity=${entityId}&event=${a.id}`}
                  >
                    Inspect event
                  </Link>
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        !error && (
          <Empty
            title={loading ? 'Loading history…' : 'History starts with the first change'}
            text="Material events retain their actor, reason, and time."
          />
        )
      )}
      <Link className="text-link" href={`/logs?actor=all&entity=${entityId}`}>
        View all related logs
      </Link>
    </>
  );
}
