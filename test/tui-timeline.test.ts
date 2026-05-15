import { describe, expect, it } from "vitest";
import { appendUserItem, reduceTimelineEvent } from "../src/tui/timeline/reducer.js";
import type { TimelineItem, ToolTimelineItem } from "../src/tui/timeline/types.js";
import {
  classifyResultStatus,
  toolDisplayName,
  truncateDetail,
  isImportantTool,
  makeToolItem,
  summarizeToolResult,
  summarizeToolApproval,
} from "../src/tui/timeline/tool-summary.js";

function getTools(timeline: TimelineItem[]): ToolTimelineItem[] {
  const tools: ToolTimelineItem[] = [];
  for (const item of timeline) {
    if (item.type === "assistant") {
      for (const part of item.parts) {
        if (part.type === "tool") tools.push(part.tool);
      }
    }
  }
  return tools;
}

function getLastAssistant(timeline: TimelineItem[]) {
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i]!.type === "assistant") return timeline[i]!;
  }
  return undefined;
}

describe("appendUserItem", () => {
  it("appends a user item to empty timeline", () => {
    const result = appendUserItem([], "hello");
    expect(result).toEqual([{ type: "user", text: "hello" }]);
  });

  it("appends to existing timeline", () => {
    const timeline = appendUserItem([], "first");
    const result = appendUserItem(timeline, "second");
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ type: "user", text: "second" });
  });
});

describe("reduceTimelineEvent", () => {
  it("assistant_text_delta creates streaming text part without duplication", () => {
    let tl: TimelineItem[] = [];
    tl = reduceTimelineEvent(tl, { type: "assistant_text_delta", text: "hello" });
    tl = reduceTimelineEvent(tl, { type: "assistant_text_delta", text: " world" });

    expect(tl).toHaveLength(1);
    const asst = tl[0]!;
    expect(asst.type).toBe("assistant");
    if (asst.type === "assistant") {
      expect(asst.parts).toHaveLength(1);
      expect(asst.parts[0]).toEqual({
        type: "text",
        text: "hello world",
        streaming: true,
      });
    }
  });

  it("assistant_message finalizes streaming and adds tool calls as queued", () => {
    let tl: TimelineItem[] = [];
    tl = reduceTimelineEvent(tl, { type: "assistant_text_delta", text: "thinking" });
    tl = reduceTimelineEvent(tl, {
      type: "assistant_message",
      message: {
        role: "assistant",
        content: "final answer",
        toolCalls: [{ id: "tc1", name: "read_file", input: { path: "a.ts" } }],
      },
    });

    expect(tl).toHaveLength(1);
    const asst = getLastAssistant(tl)!;
    expect(asst.type).toBe("assistant");
    if (asst.type !== "assistant") return;

    const textParts = asst.parts.filter((p) => p.type === "text");
    expect(textParts).toHaveLength(1);
    expect(textParts[0]).toEqual({
      type: "text",
      text: "final answer",
      streaming: false,
    });

    const toolParts = asst.parts.filter((p) => p.type === "tool");
    expect(toolParts).toHaveLength(1);
    if (toolParts[0]!.type === "tool") {
      expect(toolParts[0]!.tool.status).toBe("queued");
      expect(toolParts[0]!.tool.callId).toBe("tc1");
    }
  });

  it("streaming delta + assistant_message does not produce duplicate text", () => {
    let tl: TimelineItem[] = [];
    tl = reduceTimelineEvent(tl, { type: "assistant_text_delta", text: "hello" });
    tl = reduceTimelineEvent(tl, {
      type: "assistant_message",
      message: { role: "assistant", content: "hello final" },
    });

    const asst = getLastAssistant(tl)!;
    if (asst.type !== "assistant") return;
    const textParts = asst.parts.filter((p) => p.type === "text");
    expect(textParts).toHaveLength(1);
    expect(textParts[0]).toEqual({
      type: "text",
      text: "hello final",
      streaming: false,
    });
  });

  it("tool_started updates same tool part to running", () => {
    let tl: TimelineItem[] = [];
    tl = reduceTimelineEvent(tl, {
      type: "assistant_message",
      message: {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tc1", name: "read_file", input: { path: "a.ts" } }],
      },
    });
    tl = reduceTimelineEvent(tl, {
      type: "tool_started",
      id: "tc1",
      name: "read_file",
      input: { path: "a.ts" },
    });

    const tools = getTools(tl);
    expect(tools).toHaveLength(1);
    expect(tools[0]!.status).toBe("running");
    expect(tools[0]!.displayName).toBe("read_file");
  });

  it("tool_result updates same tool part to ok", () => {
    let tl: TimelineItem[] = [];
    tl = reduceTimelineEvent(tl, {
      type: "assistant_message",
      message: {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tc1", name: "read_file", input: { path: "a.ts" } }],
      },
    });
    tl = reduceTimelineEvent(tl, {
      type: "tool_result",
      message: {
        role: "tool_result",
        toolCallId: "tc1",
        toolName: "read_file",
        content: "file contents here",
      },
    });

    const tools = getTools(tl);
    expect(tools).toHaveLength(1);
    expect(tools[0]!.status).toBe("ok");
  });

  it("apply_patch validation failure marks as invalid", () => {
    let tl: TimelineItem[] = [];
    tl = reduceTimelineEvent(tl, {
      type: "assistant_message",
      message: {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tc1", name: "apply_patch", input: { patch: "..." } }],
      },
    });
    tl = reduceTimelineEvent(tl, {
      type: "tool_result",
      message: {
        role: "tool_result",
        toolCallId: "tc1",
        toolName: "apply_patch",
        content: "Patch validation failed before execution: hunk mismatch",
      },
    });

    const tools = getTools(tl);
    expect(tools[0]!.status).toBe("invalid");
    expect(tools[0]!.important).toBe(true);
  });

  it("denied result marks as denied", () => {
    let tl: TimelineItem[] = [];
    tl = reduceTimelineEvent(tl, {
      type: "assistant_message",
      message: {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tc1", name: "bash", input: { command: "rm -rf /" } }],
      },
    });
    tl = reduceTimelineEvent(tl, {
      type: "tool_result",
      message: {
        role: "tool_result",
        toolCallId: "tc1",
        toolName: "bash",
        content: "Tool call denied and was not executed: dangerous command",
      },
    });

    const tools = getTools(tl);
    expect(tools[0]!.status).toBe("denied");
    expect(tools[0]!.important).toBe(true);
  });

  it("Error result marks as failed", () => {
    let tl: TimelineItem[] = [];
    tl = reduceTimelineEvent(tl, {
      type: "assistant_message",
      message: {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tc1", name: "bash", input: { command: "ls" } }],
      },
    });
    tl = reduceTimelineEvent(tl, {
      type: "tool_result",
      message: {
        role: "tool_result",
        toolCallId: "tc1",
        toolName: "bash",
        content: "Error: command not found",
      },
    });

    const tools = getTools(tl);
    expect(tools[0]!.status).toBe("failed");
    expect(tools[0]!.important).toBe(true);
  });

  it("approval required/decision flow updates tool status correctly", () => {
    let tl: TimelineItem[] = [];
    tl = reduceTimelineEvent(tl, {
      type: "assistant_message",
      message: {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tc1", name: "edit_file", input: { path: "a.ts" } }],
      },
    });
    tl = reduceTimelineEvent(tl, {
      type: "tool_approval_required",
      id: "tc1",
      name: "edit_file",
      input: { path: "a.ts" },
      reason: "File write inside workspace",
      metadata: {},
    });

    let tools = getTools(tl);
    expect(tools[0]!.status).toBe("approval");

    tl = reduceTimelineEvent(tl, {
      type: "tool_approval_decision",
      id: "tc1",
      name: "edit_file",
      decision: "allow",
    });
    tools = getTools(tl);
    expect(tools[0]!.status).toBe("queued");

    tl = reduceTimelineEvent(tl, {
      type: "tool_started",
      id: "tc1",
      name: "edit_file",
      input: { path: "a.ts" },
    });
    tools = getTools(tl);
    expect(tools[0]!.status).toBe("running");

    tl = reduceTimelineEvent(tl, {
      type: "tool_result",
      message: {
        role: "tool_result",
        toolCallId: "tc1",
        toolName: "edit_file",
        content: "File edited successfully",
      },
    });
    tools = getTools(tl);
    expect(tools[0]!.status).toBe("ok");
  });

  it("denied approval decision marks as denied", () => {
    let tl: TimelineItem[] = [];
    tl = reduceTimelineEvent(tl, {
      type: "assistant_message",
      message: {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tc1", name: "bash", input: { command: "rm" } }],
      },
    });
    tl = reduceTimelineEvent(tl, {
      type: "tool_approval_required",
      id: "tc1",
      name: "bash",
      input: { command: "rm" },
      reason: "Dangerous command",
      metadata: {},
    });
    tl = reduceTimelineEvent(tl, {
      type: "tool_approval_decision",
      id: "tc1",
      name: "bash",
      decision: "deny",
    });

    const tools = getTools(tl);
    expect(tools[0]!.status).toBe("denied");
    expect(tools[0]!.important).toBe(true);
  });

  it("multiple tool calls maintain order", () => {
    let tl: TimelineItem[] = [];
    tl = reduceTimelineEvent(tl, {
      type: "assistant_message",
      message: {
        role: "assistant",
        content: "working",
        toolCalls: [
          { id: "tc1", name: "read_file", input: { path: "a.ts" } },
          { id: "tc2", name: "grep", input: { pattern: "foo" } },
          { id: "tc3", name: "edit_file", input: { path: "b.ts" } },
        ],
      },
    });
    tl = reduceTimelineEvent(tl, {
      type: "tool_started",
      id: "tc1",
      name: "read_file",
      input: { path: "a.ts" },
    });
    tl = reduceTimelineEvent(tl, {
      type: "tool_result",
      message: {
        role: "tool_result",
        toolCallId: "tc1",
        toolName: "read_file",
        content: "contents",
      },
    });

    const tools = getTools(tl);
    expect(tools).toHaveLength(3);
    expect(tools[0]!.callId).toBe("tc1");
    expect(tools[0]!.status).toBe("ok");
    expect(tools[1]!.callId).toBe("tc2");
    expect(tools[1]!.status).toBe("queued");
    expect(tools[2]!.callId).toBe("tc3");
    expect(tools[2]!.status).toBe("queued");
  });

  it("sensitive input summary is hidden", () => {
    let tl: TimelineItem[] = [];
    tl = reduceTimelineEvent(tl, {
      type: "tool_approval_required",
      id: "tc1",
      name: "write_file",
      input: { path: ".env", content: "API_KEY=sk-secret" },
      reason: "Sensitive file",
      metadata: { sensitive: true },
    });

    const tools = getTools(tl);
    expect(tools[0]!.sensitive).toBe(true);
    expect(tools[0]!.summary).not.toContain("sk-secret");
  });

  it("long successful read-only tool output has no detail", () => {
    let tl: TimelineItem[] = [];
    tl = reduceTimelineEvent(tl, {
      type: "assistant_message",
      message: {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tc1", name: "list_dir", input: { path: "." } }],
      },
    });
    const longContent = Array.from({ length: 50 }, (_, i) => `file_${i}.ts`).join("\n");
    tl = reduceTimelineEvent(tl, {
      type: "tool_result",
      message: {
        role: "tool_result",
        toolCallId: "tc1",
        toolName: "list_dir",
        content: longContent,
      },
    });

    const tools = getTools(tl);
    expect(tools[0]!.status).toBe("ok");
    expect(tools[0]!.detail).toBeUndefined();
    expect(tools[0]!.important).toBe(false);
  });

  it("mutation tool ok result has detail", () => {
    let tl: TimelineItem[] = [];
    tl = reduceTimelineEvent(tl, {
      type: "assistant_message",
      message: {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tc1", name: "edit_file", input: { path: "a.ts" } }],
      },
    });
    tl = reduceTimelineEvent(tl, {
      type: "tool_result",
      message: {
        role: "tool_result",
        toolCallId: "tc1",
        toolName: "edit_file",
        content: "File edited successfully\n2 lines changed",
      },
    });

    const tools = getTools(tl);
    expect(tools[0]!.status).toBe("ok");
    expect(tools[0]!.detail).toBeDefined();
    expect(tools[0]!.important).toBe(true);
  });

  it("long bash output ok has no detail (not a mutation tool)", () => {
    let tl: TimelineItem[] = [];
    tl = reduceTimelineEvent(tl, {
      type: "assistant_message",
      message: {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tc1", name: "bash", input: { command: "ls" } }],
      },
    });
    const longContent = Array.from(
      { length: 20 },
      (_, i) => `line ${i + 1}: this is a longer line to exceed 200 chars total`,
    ).join("\n");
    tl = reduceTimelineEvent(tl, {
      type: "tool_result",
      message: {
        role: "tool_result",
        toolCallId: "tc1",
        toolName: "bash",
        content: longContent,
      },
    });

    const tools = getTools(tl);
    expect(tools[0]!.status).toBe("ok");
    expect(tools[0]!.detail).toBeUndefined();
  });

  it("turn_truncated appends warning status", () => {
    let tl: TimelineItem[] = [];
    tl = reduceTimelineEvent(tl, { type: "turn_truncated" });

    expect(tl).toHaveLength(1);
    expect(tl[0]).toEqual({
      type: "status",
      level: "warn",
      text: "Turn truncated — model hit output token limit.",
    });
  });

  it("turn_finished clears streaming flags", () => {
    let tl: TimelineItem[] = [];
    tl = reduceTimelineEvent(tl, { type: "assistant_text_delta", text: "hello" });
    tl = reduceTimelineEvent(tl, { type: "turn_finished" });

    const asst = getLastAssistant(tl)!;
    if (asst.type !== "assistant") return;
    const textParts = asst.parts.filter((p) => p.type === "text");
    expect(textParts[0]!.streaming).toBe(false);
  });

  it("bash intent label appears in displayName", () => {
    let tl: TimelineItem[] = [];
    tl = reduceTimelineEvent(tl, {
      type: "tool_started",
      id: "tc1",
      name: "bash",
      input: { command: "ls", intentKind: "fs_primitive" },
    });

    const tools = getTools(tl);
    expect(tools[0]!.displayName).toBe("bash (fs_primitive)");
  });

  it("tool_call event creates queued tool part", () => {
    let tl: TimelineItem[] = [];
    tl = reduceTimelineEvent(tl, {
      type: "tool_call",
      id: "tc1",
      name: "read_file",
      input: { path: "a.ts" },
    });

    const tools = getTools(tl);
    expect(tools).toHaveLength(1);
    expect(tools[0]!.status).toBe("queued");
    expect(tools[0]!.callId).toBe("tc1");
  });

  it("full user → streaming → message → tool → result flow", () => {
    let tl: TimelineItem[] = [];

    tl = appendUserItem(tl, "read the file");

    tl = reduceTimelineEvent(tl, { type: "assistant_text_delta", text: "I'll" });
    tl = reduceTimelineEvent(tl, { type: "assistant_text_delta", text: " read it." });

    tl = reduceTimelineEvent(tl, {
      type: "assistant_message",
      message: {
        role: "assistant",
        content: "I'll read it for you.",
        toolCalls: [{ id: "tc1", name: "read_file", input: { path: "a.ts" } }],
      },
    });

    tl = reduceTimelineEvent(tl, {
      type: "tool_started",
      id: "tc1",
      name: "read_file",
      input: { path: "a.ts" },
    });

    tl = reduceTimelineEvent(tl, {
      type: "tool_result",
      message: {
        role: "tool_result",
        toolCallId: "tc1",
        toolName: "read_file",
        content: "file contents",
      },
    });

    tl = reduceTimelineEvent(tl, { type: "turn_finished" });

    expect(tl).toHaveLength(2);
    expect(tl[0]!.type).toBe("user");
    expect(tl[1]!.type).toBe("assistant");

    const asst = tl[1]!;
    if (asst.type !== "assistant") return;
    const textParts = asst.parts.filter((p) => p.type === "text");
    const toolParts = asst.parts.filter((p) => p.type === "tool");

    expect(textParts).toHaveLength(1);
    expect((textParts[0] as any).text).toBe("I'll read it for you.");
    expect((textParts[0] as any).streaming).toBe(false);

    expect(toolParts).toHaveLength(1);
    expect((toolParts[0] as any).tool.status).toBe("ok");
  });

  it("multi-round: second round assistant appears after second user message", () => {
    let tl: TimelineItem[] = [];

    // Round 1
    tl = appendUserItem(tl, "read a.ts");
    tl = reduceTimelineEvent(tl, { type: "assistant_text_delta", text: "ok" });
    tl = reduceTimelineEvent(tl, {
      type: "assistant_message",
      message: {
        role: "assistant",
        content: "reading",
        toolCalls: [{ id: "tc1", name: "read_file", input: { path: "a.ts" } }],
      },
    });
    tl = reduceTimelineEvent(tl, {
      type: "tool_result",
      message: {
        role: "tool_result",
        toolCallId: "tc1",
        toolName: "read_file",
        content: "file A",
      },
    });
    tl = reduceTimelineEvent(tl, { type: "turn_finished" });

    expect(tl).toHaveLength(2);
    expect(tl[0]!.type).toBe("user");
    expect(tl[1]!.type).toBe("assistant");

    // Round 2
    tl = appendUserItem(tl, "now read b.ts");
    tl = reduceTimelineEvent(tl, { type: "assistant_text_delta", text: "sure" });
    tl = reduceTimelineEvent(tl, {
      type: "assistant_message",
      message: {
        role: "assistant",
        content: "reading b",
        toolCalls: [{ id: "tc2", name: "read_file", input: { path: "b.ts" } }],
      },
    });
    tl = reduceTimelineEvent(tl, {
      type: "tool_result",
      message: {
        role: "tool_result",
        toolCallId: "tc2",
        toolName: "read_file",
        content: "file B",
      },
    });
    tl = reduceTimelineEvent(tl, { type: "turn_finished" });

    expect(tl).toHaveLength(4);
    expect(tl[0]!.type).toBe("user");
    expect(tl[1]!.type).toBe("assistant");
    expect(tl[2]!.type).toBe("user");
    expect(tl[3]!.type).toBe("assistant");

    const asst1 = tl[1]!;
    const asst2 = tl[3]!;
    if (asst1.type !== "assistant" || asst2.type !== "assistant") return;

    const tools1 = asst1.parts.filter((p) => p.type === "tool");
    const tools2 = asst2.parts.filter((p) => p.type === "tool");
    expect(tools1).toHaveLength(1);
    expect(tools2).toHaveLength(1);
    expect((tools1[0] as any).tool.callId).toBe("tc1");
    expect((tools2[0] as any).tool.callId).toBe("tc2");
  });

  it("multi-round: tool events after second user don't update first assistant", () => {
    let tl: TimelineItem[] = [];

    tl = appendUserItem(tl, "first");
    tl = reduceTimelineEvent(tl, {
      type: "assistant_message",
      message: {
        role: "assistant",
        content: "response 1",
        toolCalls: [{ id: "tc1", name: "read_file", input: { path: "a.ts" } }],
      },
    });
    tl = reduceTimelineEvent(tl, {
      type: "tool_result",
      message: {
        role: "tool_result",
        toolCallId: "tc1",
        toolName: "read_file",
        content: "ok",
      },
    });
    tl = reduceTimelineEvent(tl, { type: "turn_finished" });

    // Second user message
    tl = appendUserItem(tl, "second");

    // Streaming starts — should create NEW assistant after second user
    tl = reduceTimelineEvent(tl, { type: "assistant_text_delta", text: "response 2" });

    // Verify structure: user, assistant1, user, assistant2
    expect(tl).toHaveLength(4);
    expect(tl[0]!.type).toBe("user");
    expect(tl[1]!.type).toBe("assistant");
    expect(tl[2]!.type).toBe("user");
    expect(tl[3]!.type).toBe("assistant");

    const asst1 = tl[1]!;
    const asst2 = tl[3]!;
    if (asst1.type !== "assistant" || asst2.type !== "assistant") return;

    // First assistant should still have its tool, second has streaming text
    expect(asst1.parts.some((p) => p.type === "tool")).toBe(true);
    expect(asst2.parts.some((p) => p.type === "text")).toBe(true);
    expect(asst2.parts.some((p) => p.type === "tool")).toBe(false);
  });

  it("apply_patch approval shows diff metadata, not raw patch", () => {
    let tl: TimelineItem[] = [];
    tl = reduceTimelineEvent(tl, {
      type: "tool_approval_required",
      id: "tc1",
      name: "apply_patch",
      input: {
        patch: "*** Begin Patch\n--- a/file.ts\n+++ b/file.ts\n@@\n-old\n+new\n",
        path: "file.ts",
      },
      reason: "File write inside workspace",
      metadata: {},
    });

    const tools = getTools(tl);
    expect(tools[0]!.summary).toContain("+1");
    expect(tools[0]!.summary).toContain("-1");
    expect(tools[0]!.summary).not.toContain("*** Begin Patch");
    expect(tools[0]!.summary).not.toContain("old");
  });
});

describe("classifyResultStatus", () => {
  it("detects invalid from patch validation", () => {
    expect(
      classifyResultStatus("Patch validation failed before execution: bad hunk"),
    ).toBe("invalid");
  });

  it("detects denied", () => {
    expect(
      classifyResultStatus("Tool call denied and was not executed: user said no"),
    ).toBe("denied");
  });

  it("detects failed from Error prefix", () => {
    expect(classifyResultStatus("Error: something went wrong")).toBe("failed");
  });

  it("returns ok for normal output", () => {
    expect(classifyResultStatus("file contents here")).toBe("ok");
  });
});

describe("toolDisplayName", () => {
  it("shows intent kind for bash", () => {
    expect(toolDisplayName("bash", { command: "ls", intentKind: "fs_primitive" })).toBe(
      "bash (fs_primitive)",
    );
  });

  it("returns name as-is for non-bash", () => {
    expect(toolDisplayName("read_file")).toBe("read_file");
  });

  it("returns bash as-is without intentKind", () => {
    expect(toolDisplayName("bash", { command: "ls" })).toBe("bash");
  });
});

describe("truncateDetail", () => {
  it("returns short content unchanged", () => {
    expect(truncateDetail("line1\nline2")).toBe("line1\nline2");
  });

  it("truncates long content with line count", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i}`);
    const result = truncateDetail(lines.join("\n"));
    expect(result).toContain("+7 lines");
    expect(result.split("\n")).toHaveLength(4);
  });
});

describe("isImportantTool", () => {
  it("mutation tools are always important", () => {
    expect(isImportantTool("edit_file", "ok")).toBe(true);
    expect(isImportantTool("write_file", "ok")).toBe(true);
    expect(isImportantTool("apply_patch", "ok")).toBe(true);
  });

  it("failed/denied/invalid/approval are always important", () => {
    expect(isImportantTool("read_file", "failed")).toBe(true);
    expect(isImportantTool("read_file", "denied")).toBe(true);
    expect(isImportantTool("read_file", "invalid")).toBe(true);
    expect(isImportantTool("read_file", "approval")).toBe(true);
  });

  it("read-only ok/queued/running tools are not important", () => {
    expect(isImportantTool("read_file", "ok")).toBe(false);
    expect(isImportantTool("grep", "ok")).toBe(false);
    expect(isImportantTool("read_file", "queued")).toBe(false);
    expect(isImportantTool("read_file", "running")).toBe(false);
  });

  it("sensitive makes it important", () => {
    expect(isImportantTool("read_file", "ok", true)).toBe(true);
  });
});

describe("makeToolItem", () => {
  it("creates queued tool with display name and summary", () => {
    const item = makeToolItem("tc1", "read_file", { path: "a.ts" });
    expect(item.callId).toBe("tc1");
    expect(item.name).toBe("read_file");
    expect(item.displayName).toBe("read_file");
    expect(item.status).toBe("queued");
    expect(item.summary).toContain("path");
    expect(item.important).toBe(false);
  });

  it("creates sensitive tool item", () => {
    const item = makeToolItem(
      "tc1",
      "write_file",
      { path: ".env", content: "secret" },
      { sensitive: true },
    );
    expect(item.sensitive).toBe(true);
    expect(item.summary).toContain("[...]");
    expect(item.summary).not.toContain("secret");
    expect(item.important).toBe(true);
  });
});

describe("summarizeToolResult", () => {
  const baseTool: ToolTimelineItem = {
    callId: "tc1",
    name: "read_file",
    displayName: "read_file",
    status: "queued",
    summary: "path: a.ts",
    important: false,
  };

  it("summarizes read_file with line count", () => {
    const content = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");
    const result = summarizeToolResult("read_file", content, "ok", baseTool);
    expect(result).toContain("10 lines");
  });

  it("summarizes grep with match count", () => {
    const content = "file1.ts:1:foo\nfile2.ts:5:foo\nfile3.ts:8:foo";
    const result = summarizeToolResult("grep", content, "ok", baseTool);
    expect(result).toContain("3 match");
  });

  it("summarizes glob with file count", () => {
    const content = "a.ts\nb.ts\nc.ts";
    const result = summarizeToolResult("glob", content, "ok", baseTool);
    expect(result).toContain("3 file");
  });

  it("summarizes list_dir with entry count", () => {
    const content = "a.ts\nb.ts";
    const result = summarizeToolResult("list_dir", content, "ok", baseTool);
    expect(result).toContain("2 entr");
  });

  it("summarizes failed with first line", () => {
    const result = summarizeToolResult(
      "read_file",
      "Error: permission denied",
      "failed",
      baseTool,
    );
    expect(result).toContain("failed");
    expect(result).toContain("permission denied");
  });

  it("summarizes bash with line count for long output", () => {
    const content = Array.from({ length: 5 }, (_, i) => `line ${i}`).join("\n");
    const result = summarizeToolResult("bash", content, "ok", {
      ...baseTool,
      name: "bash",
      displayName: "bash",
    });
    expect(result).toContain("5 lines");
  });
});

describe("summarizeToolApproval", () => {
  it("shows diff metadata for apply_patch", () => {
    const result = summarizeToolApproval(
      "apply_patch",
      {
        patch:
          "*** Begin Patch\n--- a/file.ts\n+++ b/file.ts\n@@\n-old line\n+new line\n+another line\n",
        path: "file.ts",
      },
      "requires approval",
      {},
    );
    expect(result).toContain("+2");
    expect(result).toContain("-1");
    expect(result).toContain("file.ts");
    expect(result).not.toContain("*** Begin Patch");
  });

  it("shows path and reason for edit_file", () => {
    const result = summarizeToolApproval(
      "edit_file",
      { path: "src/app.ts" },
      "File write inside workspace",
      {},
    );
    expect(result).toContain("src/app.ts");
    expect(result).toContain("File write inside workspace");
  });

  it("shows command for bash", () => {
    const result = summarizeToolApproval(
      "bash",
      { command: "mkdir output" },
      "needs approval",
      {},
    );
    expect(result).toContain("mkdir output");
  });

  it("hides content for sensitive write_file", () => {
    const result = summarizeToolApproval(
      "write_file",
      { path: ".env", content: "API_KEY=sk-secret123" },
      "Sensitive file",
      {},
      { sensitive: true },
    );
    expect(result).toContain(".env");
    expect(result).not.toContain("sk-secret123");
  });
});
