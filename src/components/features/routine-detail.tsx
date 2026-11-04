'use client';
import Link from 'next/link';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import type { Operation } from '../../domain/types';
import { useWorkspace } from '../workspace/context';
import { useActions } from '../workspace/use-actions';
import { fmt, datetime, iso, str, reason } from '../workspace/helpers';
export function RoutineDetail({ operation }: { operation: Operation }) {
  const { state } = useWorkspace();
  const { records, open, base, human, assignmentField } = useActions();
  return (
    <>
      <Link className="back-link" href="/routines">
        <ArrowLeft size={15} />
        All routines
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Routine</span>
          <h1>{operation.title}</h1>
          <p className="subtitle">{operation.purpose}</p>
        </div>
      </div>
      <div className="next-action-panel">
        <p>
          Expected every {operation.cadenceHours} hours · Next expected {fmt(operation.expectedAt)}
        </p>
        <p>
          {operation.latestExecutionId
            ? `Latest attempt: ${state.executions.find((e) => e.id === operation.latestExecutionId)?.state}`
            : 'No execution reported'}{' '}
          ·{' '}
          {operation.latestVerifiedExecutionId
            ? 'Verified successful execution available'
            : 'No verified success'}
        </p>
        <p className="muted">Scheduled externally. Accord observes this operation.</p>
        <div className="button-row">
          <button
            className="button secondary small"
            onClick={() =>
              open(
                'Update recurring operation',
                'operation.update',
                [
                  { name: 'title', label: 'Title', value: operation.title },
                  { name: 'purpose', label: 'Purpose', value: operation.purpose },
                  {
                    name: 'cadenceHours',
                    label: 'Expected cadence (hours)',
                    type: 'number',
                    value: String(operation.cadenceHours),
                  },
                  {
                    name: 'expectedAt',
                    label: 'Next expected execution',
                    type: 'datetime-local',
                    value: datetime(operation.expectedAt),
                  },
                  assignmentField(operation.assignedAgentIds),
                  reason,
                ],
                (f) => ({
                  ...base(operation, f),
                  title: str(f, 'title'),
                  purpose: str(f, 'purpose'),
                  cadenceHours: Number(f.get('cadenceHours')),
                  expectedAt: iso(f, 'expectedAt'),
                  assignedAgentIds: f.getAll('assignedAgentIds'),
                }),
              )
            }
          >
            Edit routine
          </button>
          <button
            className="button secondary small"
            onClick={() =>
              open(
                'Record operation attempt',
                'execution.start',
                [
                  {
                    name: 'grantId',
                    label: 'Applicable permission',
                    type: 'select',
                    options: state.grants
                      .filter(
                        (g) =>
                          g.operationId === operation.id &&
                          g.granteeId === human?.id &&
                          !g.revokedAt,
                      )
                      .map((g) => ({
                        value: g.id,
                        label: `${g.operations.join(', ')} · ${g.used}/${g.maxUses}`,
                      })),
                  },
                  { name: 'operation', label: 'Exact operation' },
                  { name: 'target', label: 'Exact target' },
                  {
                    name: 'declaredCost',
                    label: 'Declared cost',
                    type: 'number',
                    value: '0',
                  },
                  { name: 'currency', label: 'Currency', value: 'USD' },
                  reason,
                ],
                (f) => ({
                  operationId: operation.id,
                  expectedVersion: operation.version,
                  grantId: str(f, 'grantId'),
                  operation: str(f, 'operation'),
                  target: str(f, 'target'),
                  declaredCost: Number(f.get('declaredCost')),
                  currency: str(f, 'currency'),
                  reason: str(f, 'reason'),
                }),
              )
            }
          >
            Start attempt
          </button>
        </div>
      </div>
      {operation.incidents.map((i) => (
        <Link className="work-row" href={`/tasks/${i.workstreamId}`} key={i.key}>
          Incident · {i.key}
          <ChevronRight size={18} />
        </Link>
      ))}
      {records(operation)}
    </>
  );
}
