'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { Workstream } from '../../domain/types';
import { useTaskActions } from '../workspace/use-task-actions';
import { stages, taskStage } from '../workspace/ui';

export function TaskProperties({
  task: w,
  showProject = false,
  disabled = false,
  requestChange = (action) => action(),
}: {
  task: Workstream;
  showProject?: boolean;
  disabled?: boolean;
  requestChange?: (action: () => void) => void;
}) {
  const { state, pending, patch, move } = useTaskActions();
  const closed = ['completed', 'cancelled', 'dismissed'].includes(w.status);
  return (
    <>
      <label>
        Status
        <select
          disabled={pending || disabled}
          aria-label="Task status"
          value={taskStage(w)}
          onChange={(e) => {
            const value = e.target.value;
            requestChange(() => move(w, value));
          }}
        >
          {stages.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
          {['cancelled', 'dismissed'].includes(w.status) && (
            <option value={w.status}>{w.status}</option>
          )}
        </select>
      </label>
      <label>
        Owner
        <select
          aria-label="Task owner"
          disabled={closed || pending || disabled}
          value={w.ownerId}
          onChange={(e) => {
            const id = e.target.value;
            requestChange(() => {
              void patch(w, {
                ownerId: id,
                assignedAgentIds:
                  state.identities.find((i) => i.id === id)?.kind === 'agent'
                    ? Array.from(new Set([...w.assignedAgentIds, id]))
                    : w.assignedAgentIds,
              });
            });
          }}
        >
          {state.identities
            .filter((i) => ['human', 'agent'].includes(i.kind))
            .map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
        </select>
      </label>
      {showProject && (
        <label>
          Project
          <select
            aria-label="Task project"
            disabled={closed || pending || disabled}
            value={w.projectId ?? ''}
            onChange={(e) => void patch(w, { projectId: e.target.value || null })}
          >
            <option value="">No project</option>
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.status === 'archived' ? ' (archived)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Priority
        <select
          aria-label="Task priority"
          disabled={closed || pending || disabled}
          value={w.priority ?? 'none'}
          onChange={(e) => {
            const priority = e.target.value as Workstream['priority'];
            requestChange(() => {
              void patch(w, { priority });
            });
          }}
        >
          {['none', 'low', 'medium', 'high', 'urgent'].map((p) => (
            <option key={p} value={p}>
              {p[0].toUpperCase() + p.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Due date
        <input
          aria-label="Task due date"
          type="date"
          disabled={closed || pending || disabled}
          value={w.dueDate ?? ''}
          onChange={(e) => {
            const dueDate = e.target.value || null;
            requestChange(() => {
              void patch(w, { dueDate });
            });
          }}
        />
      </label>
    </>
  );
}

export function EditableText({
  label,
  value,
  onSave,
  disabled,
  heading = false,
  placeholder,
  onDirtyChange,
  headingLevel = 1,
}: {
  label: string;
  value: string;
  onSave: (value: string) => Promise<boolean>;
  disabled?: boolean;
  heading?: boolean;
  placeholder?: string;
  onDirtyChange?: (key: string, dirty: boolean) => void;
  headingLevel?: 1 | 2;
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(value);
  const id = useId(),
    save = useRef(onSave),
    baseline = useRef(value),
    submitting = useRef(false),
    Heading = headingLevel === 2 ? 'h2' : 'h1';
  const dirty = editing && draft !== baseline.current;
  useEffect(() => {
    onDirtyChange?.(id, dirty);
    return () => onDirtyChange?.(id, false);
  }, [id, dirty, onDirtyChange]);
  return editing ? (
    <form
      className="inline-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        if (disabled || submitting.current) return;
        submitting.current = true;
        try {
          if (await save.current(draft.trim())) setEditing(false);
        } finally {
          submitting.current = false;
        }
      }}
    >
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      {heading ? (
        <input
          id={id}
          disabled={disabled}
          value={draft}
          required
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
        />
      ) : (
        <textarea
          id={id}
          disabled={disabled}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
        />
      )}
      <div className="button-row">
        <button className="button small" disabled={disabled}>
          Save
        </button>
        <button
          type="button"
          disabled={disabled}
          className="button secondary small"
          onClick={() => {
            setDraft(value);
            setEditing(false);
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  ) : (
    <button
      disabled={disabled}
      className={`editable ${heading ? 'editable-title' : ''}`}
      aria-label={`Edit ${label.toLowerCase()}`}
      onClick={() => {
        baseline.current = value;
        save.current = onSave;
        setDraft(value);
        setEditing(true);
      }}
    >
      {heading ? <Heading>{value}</Heading> : <span>{value || placeholder || 'Add details…'}</span>}
    </button>
  );
}
