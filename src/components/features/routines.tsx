'use client';
import Link from 'next/link';
import { Plus, Repeat2, ArrowUpRight } from 'lucide-react';
import { useTaskActions } from '../workspace/use-task-actions';
import { Heading, Empty } from '../workspace/ui';
import { datetime, str, iso } from '../workspace/helpers';
import { operationHealth } from '../../domain/presentation';
export function Routines() {
  const a = useTaskActions(),
    { state } = a;
  return (
    <>
      <Heading
        eyebrow="WORK THAT REPEATS"
        title="Routines"
        subtitle="See what ran, what’s due, and which results have been verified."
        action={
          <button
            className="button"
            onClick={() =>
              a.open(
                'New routine',
                'operation.create',
                [
                  { name: 'title', label: 'Routine name' },
                  { name: 'purpose', label: 'Purpose', type: 'textarea' },
                  a.ownerField(),
                  a.assignmentField(),
                  {
                    name: 'cadenceHours',
                    label: 'Repeat every (hours)',
                    type: 'number',
                    value: '168',
                  },
                  {
                    name: 'expectedAt',
                    label: 'Next expected run',
                    type: 'datetime-local',
                    value: datetime(),
                  },
                ],
                (f) => ({
                  title: str(f, 'title'),
                  purpose: str(f, 'purpose'),
                  ownerId: str(f, 'ownerId'),
                  assignedAgentIds: f.getAll('assignedAgentIds'),
                  cadenceHours: Number(f.get('cadenceHours')),
                  expectedAt: iso(f, 'expectedAt'),
                  reason: 'Registered routine',
                }),
                'Runs are scheduled by your agent or external scheduler.',
                'Create routine',
              )
            }
          >
            <Plus size={16} />
            New routine
          </button>
        }
      />
      <div className="routine-list">
        {state.operations.map((o) => (
          <Link href={`/routines/${o.id}`} className="operation-card" key={o.id}>
            <span className="operation-mark">
              <Repeat2 size={23} />
            </span>
            <div>
              <h2>{o.title}</h2>
              <p>{o.purpose}</p>
              <span className="muted">
                Every {o.cadenceHours} hours · {a.who(o.ownerId)}
              </span>
            </div>
            <div className="routine-state">
              <span className="badge">{operationHealth(o, state)}</span>
              <small>Next expected {new Date(o.expectedAt).toLocaleDateString()}</small>
            </div>
            <ArrowUpRight size={18} />
          </Link>
        ))}
      </div>
      {!state.operations.length && (
        <Empty
          title="Keep recurring work in view"
          text="Register a routine to follow its attempts, results, and recovery tasks."
        />
      )}
    </>
  );
}
