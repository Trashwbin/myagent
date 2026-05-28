import type { ApprovalRequest } from "../../../session/loop.js";
import type { SessionContextUsage } from "../../../model/types.js";
import type { ToolDisplay } from "../../../session/tool-display.js";

export type ProviderModelSummary = {
  id: string;
  provider: string;
  providerID: string;
  modelID: string;
  adapter: string;
  model: string;
  name?: string;
  variant?: string;
  variants?: string[];
  contextWindow?: number;
  mode?: string;
};

export type ProviderSummary = {
  id: string;
  name: string;
  adapters: string[];
  defaultModel?: string;
  models: ProviderModelSummary[];
};

export type ProviderConfig = {
  current: string;
  providers: ProviderSummary[];
  connected?: string[];
  default?: Record<string, string>;
  models: ProviderModelSummary[];
};

export type SessionSummary = {
  id: string;
  projectPath: string;
  workspaceRoot?: string;
  modelProfileId?: string;
  provider?: string;
  model?: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
};

export type ProjectSummary = {
  path: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  sessionCount: number;
  lastSessionId?: string;
  lastSessionUpdatedAt?: number;
};

export type MutationDiffFile = {
  path: string;
  additions: number;
  deletions: number;
  diff?: string;
  sensitive?: boolean;
};

export type TimelineTextPart = {
  id: string;
  kind: "text";
  text: string;
  phase?: "commentary" | "final";
  status?: "running" | "completed" | "failed" | "interrupted";
  streaming?: boolean;
};

export type TimelineStatusPart = {
  id: string;
  kind: "status";
  level: "info" | "warning" | "error";
  text: string;
};

export type TimelineCompactionPart = {
  id: string;
  kind: "compaction";
  summary: string;
  compactedCount?: number;
  retainedCount?: number;
  previousSummaryUsed?: boolean;
  transcriptTruncated?: boolean;
  beforeTokens?: number;
  afterTokens?: number;
  createdAt?: number;
  auto?: boolean;
  reason?: "context_limit";
};

export type TimelineToolKind = "context" | "shell" | "mutation" | "skill" | "generic";

export type TimelineToolStatus =
  | "queued"
  | "running"
  | "approval"
  | "ok"
  | "denied"
  | "invalid"
  | "failed";

export type TimelineToolPart = {
  id: string;
  kind: "tool";
  toolName: string;
  displayKind: TimelineToolKind;
  status: TimelineToolStatus;
  title: string;
  subtitle?: string;
  summary?: string;
  details?: string;
  diffFiles?: MutationDiffFile[];
  display?: ToolDisplay;
  input?: unknown;
  checkpointId?: string;
};

export type TimelinePart =
  | TimelineTextPart
  | TimelineStatusPart
  | TimelineCompactionPart
  | TimelineToolPart;

export type TimelineUserMessage = {
  id: string;
  text: string;
};

export type TimelineTurn = {
  id: string;
  userMessage: TimelineUserMessage;
  assistantParts: TimelinePart[];
  mutationDiffs: MutationDiffFile[];
  completed?: boolean;
  createdAt?: number;
  completedAt?: number;
};

export type PendingApproval = {
  sessionId: string;
  approvalId: string;
  request: ApprovalRequest;
};

export type AppState = {
  providerConfig: ProviderConfig | null;
  projects: ProjectSummary[];
  sessions: SessionSummary[];
  activeSessionId: string | null;
  timelines: Record<string, TimelineTurn[]>;
  sessionContextUsage: Record<string, SessionContextUsage>;
  loadedSessionIds: string[];
  runningSessionIds: string[];
  wsOpen: boolean;
  pendingApproval: PendingApproval | null;
};
