export type TimelineItem =
  | { type: "user"; text: string }
  | { type: "assistant"; parts: AssistantPart[] }
  | { type: "status"; level: "info" | "warn" | "error"; text: string };

export type AssistantPart =
  | { type: "text"; text: string; streaming?: boolean }
  | { type: "tool"; tool: ToolTimelineItem };

export type ToolStatus =
  | "queued"
  | "running"
  | "ok"
  | "failed"
  | "denied"
  | "invalid"
  | "approval";

export type ToolTimelineItem = {
  callId: string;
  name: string;
  displayName: string;
  status: ToolStatus;
  summary: string;
  detail?: string;
  important: boolean;
  sensitive?: boolean;
};
