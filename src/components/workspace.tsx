'use client';
import { usePathname } from 'next/navigation';
import { useWorkspace } from './workspace/context';
import { People, PersonDetail } from './features/people';
import { Today } from './features/today';
import { Tasks } from './features/tasks';
import { TaskDetail } from './features/task-detail';
import { Projects } from './features/projects';
import { Routines } from './features/routines';
import { RoutineDetail } from './features/routine-detail';
import { Agents } from './features/agents';
import { Settings } from './features/settings';
import { Logs } from './features/logs';
import { Empty } from './workspace/ui';
export function Workspace() {
  const { state } = useWorkspace(),
    path = usePathname().split('/').filter(Boolean),
    [section, id] = path;
  if (!section) return <Today />;
  if (section === 'tasks') {
    if (!id) return <Tasks />;
    const task = state.workstreams.find((w) => w.id === id);
    if (task) return <TaskDetail task={task} />;
  }
  if (section === 'projects') {
    if (!id) return <Projects />;
    const project = state.projects.find((p) => p.id === id);
    if (project) return <Tasks project={project} />;
  }
  if (section === 'routines') {
    if (!id) return <Routines />;
    const routine = state.operations.find((o) => o.id === id);
    if (routine) return <RoutineDetail operation={routine} />;
  }
  if (section === 'people') {
    if (!id) return <People />;
    const person = state.people.find((p) => p.id === id);
    if (person) return <PersonDetail person={person} />;
  }
  if (section === 'agents') return <Agents />;
  if (section === 'logs') return <Logs />;
  if (section === 'settings') return <Settings />;
  return (
    <Empty
      title="This page isn’t available"
      text="Use the workspace navigation to find your tasks and projects."
    />
  );
}
