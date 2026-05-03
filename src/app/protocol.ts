import type { ApprovalResponse } from "../permission/approval.js";
import type { TurnEvent, ApprovalRequest } from "../session/loop.js";

export type ClientMessage =
  | { type: "subscribe_session"; sessionId: string }
  | { type: "user_message"; sessionId: string; text: string }
  | { type: "approval_decision"; approvalId: string; decision: ApprovalResponse }
  | { type: "cancel_turn"; sessionId: string };

export type ServerMessage =
  | { type: "ready"; sessionId?: string }
  | { type: "turn_event"; sessionId: string; event: TurnEvent }
  | { type: "approval_required"; sessionId: string; approvalId: string; request: ApprovalRequest }
  | { type: "turn_finished"; sessionId: string }
  | { type: "error"; message: string; code?: string };

export function parseClientMessage(raw: unknown): ClientMessage | { type: "error"; message: string } {
  if (typeof raw !== "object" || raw === null) {
    return { type: "error", message: "Invalid message: not an object" };
  }
  const msg = raw as Record<string, unknown>;
  if (typeof msg.type !== "string") {
    return { type: "error", message: "Invalid message: missing type" };
  }

  switch (msg.type) {
    case "subscribe_session":
      if (typeof msg.sessionId !== "string")
        return { type: "error", message: "subscribe_session requires sessionId" };
      return { type: "subscribe_session", sessionId: msg.sessionId };

    case "user_message":
      if (typeof msg.sessionId !== "string" || typeof msg.text !== "string")
        return { type: "error", message: "user_message requires sessionId and text" };
      return { type: "user_message", sessionId: msg.sessionId, text: msg.text };

    case "approval_decision": {
      if (typeof msg.approvalId !== "string" || typeof msg.decision !== "string")
        return { type: "error", message: "approval_decision requires approvalId and decision" };
      const valid: ApprovalResponse[] = ["allow_once", "allow_for_session", "allow_for_workspace", "abort"];
      if (!valid.includes(msg.decision as ApprovalResponse))
        return { type: "error", message: `Invalid decision: ${msg.decision}` };
      return {
        type: "approval_decision",
        approvalId: msg.approvalId,
        decision: msg.decision as ApprovalResponse,
      };
    }

    case "cancel_turn":
      if (typeof msg.sessionId !== "string")
        return { type: "error", message: "cancel_turn requires sessionId" };
      return { type: "cancel_turn", sessionId: msg.sessionId };

    default:
      return { type: "error", message: `Unknown message type: ${msg.type}` };
  }
}
