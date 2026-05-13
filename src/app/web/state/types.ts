import type { ApprovalRequest } from "../../../session/loop.js";
import type { ToolDisplay } from "../../../session/tool-display.js";

export type ClientConfig = {
  cwd: string;
  provider: string;
  model: string;
  approval: string;
  models?: Array<{
    id: string;
    provider: string;
    adapter: string;
    model: string;
    name?: string;
  }>;
};

export type SessionSummary = {
  id: string;
  workspaceRoot: string;
  modelProfileId?: string;
  provider?: string;
  model?: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
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
  streaming?: boolean;
};

export type TimelineStatusPart = {
  id: string;
  kind: "status";
  level: "info" | "warning" | "error";
  text: string;
};

export type TimelineToolKind = "context" | "shell" | "mutation" | "generic";

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
};

export type TimelinePart =
  | TimelineTextPart
  | TimelineStatusPart
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
};

export type PendingApproval = {
  sessionId: string;
  approvalId: string;
  request: ApprovalRequest;
};

export type AppState = {
  config: ClientConfig | null;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  timelines: Record<string, TimelineTurn[]>;
  loadedSessionIds: string[];
  runningSessionIds: string[];
  wsOpen: boolean;
  pendingApproval: PendingApproval | null;
};
