import type { TurnEvent } from "../session/loop.js";
import type { TranscriptRow } from "./types.js";
import { formatToolInputSummary } from "../cli/format-tool-input.js";

export function toolDisplayName(name: string, input?: unknown): string {
  const intentKind =
    name === "bash" && input && typeof input === "object"
      ? (input as Record<string, unknown>).intentKind
      : undefined;
  return typeof intentKind === "string" ? `bash (${intentKind})` : name;
}

export function eventToRows(
  event: TurnEvent,
  options?: { sensitive?: boolean },
): TranscriptRow[] {
  switch (event.type) {
    case "provider_stream_started":
    case "provider_step_started":
    case "provider_step_finished":
    case "assistant_text_started":
    case "assistant_text_finished":
    case "assistant_reasoning_started":
    case "assistant_reasoning_finished":
    case "assistant_text_delta":
      return [];
    case "assistant_message": {
      const text = typeof event.message.content === "string" ? event.message.content : "";
      if (!text) return [];
      return [{ type: "assistant", text }];
    }
    case "tool_call":
      return [];
    case "tool_started": {
      const summary = formatToolInputSummary(event.input, {
        sensitive: options?.sensitive === true,
      });
      return [
        {
          type: "tool_started",
          tool: toolDisplayName(event.name, event.input),
          summary,
        },
      ];
    }
    case "tool_result":
      return [
        {
          type: "tool_result",
          tool: event.message.toolName ?? "unknown",
          content: event.message.content,
        },
      ];
    case "tool_approval_required": {
      const meta = event.metadata;
      const details: string[] = [];
      if (meta?.realPath) details.push(`path: ${meta.realPath as string}`);
      if (meta?.insideWorkspace === false) details.push("[outside workspace]");
      if (meta?.sensitive) details.push("[sensitive]");
      if (meta?.additions !== undefined || meta?.deletions !== undefined) {
        details.push(
          `changes: +${(meta.additions as number) ?? 0} -${(meta.deletions as number) ?? 0}`,
        );
      }
      if (meta?.externalDirectoryPattern) {
        details.push(`grants: ${meta.externalDirectoryPattern as string}`);
      }
      if (meta?.approvalPattern) {
        details.push(`pattern: ${meta.approvalPattern as string}`);
      }
      const inputSummary = formatToolInputSummary(event.input, {
        sensitive: meta?.sensitive === true,
      });
      if (inputSummary) details.push(`input: ${inputSummary}`);

      return [
        {
          type: "approval",
          tool: toolDisplayName(event.name, event.input),
          reason: event.reason,
          details,
        },
      ];
    }
    case "tool_approval_decision":
      return [
        {
          type: "approval_decision",
          tool: event.name,
          decision: event.decision,
        },
      ];
    case "turn_truncated":
      return [
        {
          type: "status",
          kind: "truncated",
          text: "Turn truncated — model hit output token limit.",
        },
      ];
    case "turn_finished":
      return [];
  }
}
