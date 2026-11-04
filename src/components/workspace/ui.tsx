import type { ReactNode } from 'react';
import {
  Check,
  Inbox,
  Circle,
  CircleDot,
  CircleDashed,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import type { Workstream } from '../../domain/types';
export function Heading({
  title,
  subtitle,
  action,
  eyebrow,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
export function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Inbox size={26} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function taskStage(w: Workstream) {
  return w.status === 'open' ? (w.planningStage ?? 'todo') : w.status;
}
export const stages = [
  { value: 'todo', label: 'To do', icon: Circle },
  { value: 'in_progress', label: 'In progress', icon: CircleDot },
  { value: 'blocked', label: 'Blocked', icon: AlertCircle },
  { value: 'ready_for_review', label: 'In review', icon: CircleDashed },
  { value: 'completed', label: 'Done', icon: CheckCircle2 },
];
export function Status({ task }: { task: Workstream }) {
  const stage = taskStage(task),
    s = stages.find((s) => s.value === stage),
    Icon = s?.icon ?? Check;
  return (
    <span className={`status status-${stage}`}>
      <Icon size={15} />
      {s?.label ?? stage}
    </span>
  );
}
export function Avatar({ name, agent = false }: { name: string; agent?: boolean }) {
  return (
    <span aria-label={name} className={`avatar ${agent ? 'agent-avatar' : ''}`}>
      {name
        .split(' ')
        .map((x) => x[0])
        .slice(0, 2)
        .join('')}
    </span>
  );
}
