import { defaultGroups } from './people-schema';
import type {
  Person,
  RelationshipGroup,
  Interaction,
  ImportantDate,
  Commitment,
  PeopleResponse,
} from './people-schema';
export type {
  Person,
  RelationshipGroup,
  Interaction,
  ImportantDate,
  Commitment,
  PeopleResponse,
} from './people-schema';
export type Kind = 'human' | 'agent' | 'integration' | 'third_party';
export interface Identity {
  id: string;
  name: string;
  kind: Kind;
  authUserId?: string;
  role?: string;
}
export interface Actor {
  id: string;
  workspaceId: string;
  kind: Exclude<Kind, 'third_party'>;
  scopes: string[];
  assignments: string[];
  accessMode?: 'assigned' | 'workspace';
  credentialId?: string;
}
export type Status =
  'open' | 'blocked' | 'ready_for_review' | 'completed' | 'cancelled' | 'dismissed';
export interface RecordBase {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface Criterion {
  id: string;
  text: string;
}
export interface NextAction {
  text: string;
  ownerId: string;
  dependency?: string;
  requiredAuthority?: string;
}
export interface Reference {
  id: string;
  system: string;
  objectId: string;
  url?: string;
  responsibility: string;
  reportedStatus?: string;
  checkedAt?: string;
  conflict?: string;
}
export interface TaskLink {
  id: string;
  title: string;
  url: string;
  note?: string;
}
export type Priority = 'none' | 'low' | 'medium' | 'high' | 'urgent';
export interface Project extends RecordBase {
  name: string;
  description: string;
  targetDate: string | null;
  status: 'active' | 'archived';
}
export interface Decision extends RecordBase {
  workstreamId: string;
  subjectId: string;
  subjectVersion: number;
  response: 'approved' | 'declined' | 'changes_requested' | 'accepted';
  actorId: string;
  feedback: string;
}
export interface Reminder extends RecordBase {
  subjectId: string;
  subjectVersion: number;
  until: string;
  actorId: string;
}
export interface Workstream extends RecordBase {
  projectId?: string | null;
  priority?: Priority;
  dueDate?: string | null;
  planningStage?: 'todo' | 'in_progress';
  completionPolicy?: 'simple' | 'verified';
  title: string;
  outcome: string;
  ownerId: string;
  mode: 'human_led' | 'assisted' | 'approval_required' | 'autonomous';
  assignedAgentIds: string[];
  criteria: Criterion[];
  nextAction: NextAction | null;
  status: Status;
  reviewAt: string;
  reportedProgress: string;
  verifiedAt: string | null;
  blocker: {
    cause: string;
    attemptedResolution: string;
    unblockCondition: string;
    resolverId: string;
  } | null;
  references: Reference[];
  links: TaskLink[];
  closure?: { reason: string; actorId: string; evidenceIds: string[]; at: string };
}
export interface Action extends RecordBase {
  workstreamId: string;
  revision: number;
  supersedesId?: string;
  operation: string;
  effect: string;
  target: string;
  content: string;
  scope: string;
  expiresAt: string;
  declaredCost: number;
  currency: string;
  approvalRequested: boolean;
}
export interface Grant extends RecordBase {
  type: 'one_time' | 'standing';
  actionId?: string;
  workstreamId?: string;
  operationId?: string;
  operations: string[];
  targets: string[];
  granteeId: string;
  validFrom: string;
  expiresAt: string;
  maxUses: number;
  used: number;
  costLimit?: number;
  declaredCostUsed: number;
  currency: string;
  revokedAt: string | null;
  approvedBy: string;
}
export interface Execution extends RecordBase {
  actionId?: string;
  operationId?: string;
  workstreamId?: string;
  grantId: string;
  actorId: string;
  state: 'running' | 'succeeded' | 'partial' | 'failed' | 'uncertain';
  result: string;
  externalId?: string;
  reconciledAt?: string;
  reconciliation?: string;
  verifiedAt?: string;
  evidenceIds: string[];
  incidentKey?: string;
}
export interface Evidence extends RecordBase {
  workstreamId?: string;
  operationId?: string;
  executionId?: string;
  criterionIds: string[];
  title: string;
  description: string;
  url?: string;
  storagePath?: string;
  sha256?: string;
  provenance: string;
  submittedBy: string;
  verification: 'unverified' | 'accepted' | 'independent';
  verifiedBy?: string;
  verifiedAt?: string;
  verificationNote?: string;
}
export interface Operation extends RecordBase {
  title: string;
  purpose: string;
  ownerId: string;
  assignedAgentIds: string[];
  cadenceHours: number;
  expectedAt: string;
  grantId?: string;
  latestExecutionId?: string;
  latestVerifiedExecutionId?: string;
  incidents: { key: string; workstreamId: string }[];
}
export interface Audit {
  id: string;
  actorId: string;
  at: string;
  command: string;
  entityId: string;
  reason: string;
  changes: unknown;
}
export interface State {
  timezone: string;
  people: Person[];
  relationshipGroups: RelationshipGroup[];
  interactions: Interaction[];
  importantDates: ImportantDate[];
  commitments: Commitment[];
  peopleResponses: PeopleResponse[];
  workspaceId: string;
  revision: number;
  projects: Project[];
  decisions: Decision[];
  reminders: Reminder[];
  identities: Identity[];
  workstreams: Workstream[];
  actions: Action[];
  grants: Grant[];
  executions: Execution[];
  evidence: Evidence[];
  operations: Operation[];
  audit: Audit[];
}
export type Entity =
  | Person
  | RelationshipGroup
  | Interaction
  | ImportantDate
  | Commitment
  | PeopleResponse
  | Workstream
  | Action
  | Grant
  | Execution
  | Evidence
  | Operation
  | Project
  | Decision
  | Reminder;
export const emptyState = (workspaceId: string): State => ({
  workspaceId,
  timezone: 'America/Monterrey',
  people: [],
  relationshipGroups: defaultGroups(),
  interactions: [],
  importantDates: [],
  commitments: [],
  peopleResponses: [],
  revision: 0,
  projects: [],
  decisions: [],
  reminders: [],
  identities: [],
  workstreams: [],
  actions: [],
  grants: [],
  executions: [],
  evidence: [],
  operations: [],
  audit: [],
});
