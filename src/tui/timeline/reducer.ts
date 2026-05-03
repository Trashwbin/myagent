import type { TurnEvent } from "../../session/loop.js";
import type {
  TimelineItem,
  AssistantPart,
  ToolTimelineItem,
} from "./types.js";
import {
  makeToolItem,
  classifyResultStatus,
  truncateDetail,
  toolDisplayName,
  summarizeToolResult,
  summarizeToolApproval,
} from "./tool-summary.js";
import { formatToolInputSummary } from "../../cli/format-tool-input.js";

export function appendUserItem(
  timeline: TimelineItem[],
  text: string,
): TimelineItem[] {
  return [...timeline, { type: "user", text }];
}

function activeAssistantIndex(items: TimelineItem[]): number {
  let lastUserIdx = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].type === "user") {
      lastUserIdx = i;
      break;
    }
  }

  if (lastUserIdx === -1) {
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type === "assistant") return i;
    }
    return -1;
  }

  for (let i = items.length - 1; i > lastUserIdx; i--) {
    if (items[i].type === "assistant") return i;
  }

  return -1;
}

function ensureAssistant(timeline: TimelineItem[]): TimelineItem[] {
  const idx = activeAssistantIndex(timeline);
  if (idx !== -1) return timeline;
  return [...timeline, { type: "assistant", parts: [] }];
}

function updateAssistant(
  timeline: TimelineItem[],
  updater: (parts: AssistantPart[]) => AssistantPart[],
): TimelineItem[] {
  const result = ensureAssistant(timeline);
  const idx = activeAssistantIndex(result);
  const item = result[idx]!;
  if (item.type !== "assistant") return result;
  return [
    ...result.slice(0, idx),
    { ...item, parts: updater(item.parts) },
    ...result.slice(idx + 1),
  ];
}

function findToolPartIndex(
  parts: AssistantPart[],
  callId: string,
): number {
  return parts.findIndex(
    (p) => p.type === "tool" && p.tool.callId === callId,
  );
}

function updateToolPart(
  parts: AssistantPart[],
  callId: string,
  updater: (tool: ToolTimelineItem) => ToolTimelineItem,
): AssistantPart[] {
  const idx = findToolPartIndex(parts, callId);
  if (idx === -1) return parts;
  const part = parts[idx]!;
  if (part.type !== "tool") return parts;
  return [
    ...parts.slice(0, idx),
    { type: "tool", tool: updater(part.tool) },
    ...parts.slice(idx + 1),
  ];
}

function ensureQueuedTool(
  parts: AssistantPart[],
  callId: string,
  name: string,
  input: unknown,
  options?: { sensitive?: boolean },
): AssistantPart[] {
  const idx = findToolPartIndex(parts, callId);
  if (idx !== -1) return parts;
  return [
    ...parts,
    { type: "tool", tool: makeToolItem(callId, name, input, options) },
  ];
}

export function reduceTimelineEvent(
  timeline: TimelineItem[],
  event: TurnEvent,
  options?: { sensitiveSet?: Set<string> },
): TimelineItem[] {
  switch (event.type) {
    case "assistant_text_delta": {
      return updateAssistant(timeline, (parts) => {
        const textParts = parts.filter(
          (p) => p.type === "text",
        ) as Array<{ type: "text"; text: string; streaming?: boolean }>;
        const lastText = textParts[textParts.length - 1];
        if (lastText && lastText.streaming) {
          return parts.map((p) =>
            p.type === "text" && p.streaming
              ? { type: "text", text: lastText.text + event.text, streaming: true }
              : p,
          );
        }
        return [
          ...parts,
          { type: "text", text: event.text, streaming: true },
        ];
      });
    }

    case "assistant_message": {
      const msg = event.message;
      const text =
        typeof msg.content === "string" ? msg.content : "";

      let result = updateAssistant(timeline, (parts) => {
        const updated = parts.map((p) =>
          p.type === "text" && p.streaming
            ? { type: "text" as const, text, streaming: false }
            : p,
        );

        const hasFinalText = updated.some(
          (p) => p.type === "text" && !p.streaming,
        );
        if (!hasFinalText && text) {
          updated.push({ type: "text", text, streaming: false });
        }

        return updated;
      });

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        result = updateAssistant(result, (parts) => {
          for (const tc of msg.toolCalls!) {
            parts = ensureQueuedTool(parts, tc.id, tc.name, tc.input);
          }
          return parts;
        });
      }

      return result;
    }

    case "tool_call": {
      return updateAssistant(timeline, (parts) =>
        ensureQueuedTool(parts, event.id, event.name, event.input),
      );
    }

    case "tool_approval_required": {
      const sensitive = event.metadata?.sensitive === true;
      return updateAssistant(timeline, (parts) => {
        parts = ensureQueuedTool(parts, event.id, event.name, event.input, {
          sensitive,
        });
        return updateToolPart(parts, event.id, (tool) => {
          const approvalSummary = summarizeToolApproval(
            tool.name,
            event.input,
            event.reason,
            event.metadata,
            { sensitive },
          );
          return {
            ...tool,
            status: "approval",
            important: true,
            summary: approvalSummary,
            detail: event.reason,
            sensitive,
          };
        });
      });
    }

    case "tool_approval_decision": {
      const allowed = event.decision === "allow";
      return updateAssistant(timeline, (parts) =>
        updateToolPart(parts, event.id, (tool) => ({
          ...tool,
          status: allowed ? "queued" : "denied",
          important: !allowed,
          detail: allowed ? undefined : `Denied`,
        })),
      );
    }

    case "tool_started": {
      const sensitive =
        options?.sensitiveSet?.has(event.id) ?? false;
      return updateAssistant(timeline, (parts) => {
        parts = ensureQueuedTool(parts, event.id, event.name, event.input, {
          sensitive,
        });
        return updateToolPart(parts, event.id, (tool) => ({
          ...tool,
          status: "running",
          displayName: toolDisplayName(event.name, event.input),
          summary: formatToolInputSummary(event.input, { sensitive }),
          sensitive,
        }));
      });
    }

    case "tool_result": {
      const msg = event.message;
      const callId = msg.toolCallId;
      if (!callId) return timeline;

      const status = classifyResultStatus(msg.content);
      const isMutation =
        status !== "ok" ||
        msg.toolName === "edit_file" ||
        msg.toolName === "write_file" ||
        msg.toolName === "apply_patch";

      let detail: string | undefined;
      if (status !== "ok") {
        detail = truncateDetail(msg.content);
      } else if (isMutation) {
        detail = truncateDetail(msg.content);
      }

      return updateAssistant(timeline, (parts) =>
        updateToolPart(parts, callId, (tool) => {
          const resultSummary = summarizeToolResult(
            tool.name,
            msg.content,
            status,
            tool,
          );
          return {
            ...tool,
            status,
            summary: resultSummary,
            important: isMutation,
            detail,
          };
        }),
      );
    }

    case "turn_truncated":
      return [
        ...timeline,
        {
          type: "status",
          level: "warn",
          text: "Turn truncated — model hit output token limit.",
        },
      ];

    case "turn_finished": {
      return updateAssistant(timeline, (parts) =>
        parts.map((p) =>
          p.type === "text" && p.streaming
            ? { type: "text" as const, text: p.text, streaming: false }
            : p,
        ),
      );
    }

    default:
      return timeline;
  }
}
