import type { ApprovalResponse } from "../permission/approval.js";

export type TranscriptRow =
  | { type: "user"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool_started"; tool: string; summary: string }
  | { type: "tool_result"; tool: string; content: string }
  | { type: "approval"; tool: string; reason: string; details: string[] }
  | { type: "approval_decision"; tool: string; decision: "allow" | "deny" }
  | { type: "status"; kind: "truncated" | "aborted" | "error"; text: string };

export type TuiPhase =
  | "idle"
  | "running"
  | "waiting_approval";

export type ApprovalState = {
  toolName: string;
  reason: string;
  details: string[];
  allowAlways: boolean;
  resolve: (response: ApprovalResponse) => void;
};

export type PastePart = {
  id: number;
  text: string;
  virtualText: string;
};

export type PromptState = {
  input: string;
  parts: PastePart[];
};
