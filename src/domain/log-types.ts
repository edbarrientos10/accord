import type { Audit } from './types';
import type { CommandAttempt } from '../server/attempts';
import { activityOutcomes } from './activity';
export interface LogSummary {
  id: string;
  actorId: string;
  actorName: string;
  actorKind: string;
  at: string;
  command: string;
  entityId: string | null;
  title: string;
  reason: string;
  outcome: string;
  kind: 'change' | 'attempt';
  contextIds: string[];
}
export interface LogPage {
  items: LogSummary[];
  nextCursor: string | null;
}
export interface LogDetail {
  summary: LogSummary;
  event: Audit | null;
  attempt: CommandAttempt | null;
}
export const logOutcomes = {
  ...activityOutcomes,
  rejected: 'Command rejected',
  error: 'Attempt failed',
};
