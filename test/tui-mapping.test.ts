import { describe, expect, it } from "vitest";
import { eventToRows } from "../src/tui/mapping.js";
import type { TurnEvent } from "../src/session/loop.js";

describe("eventToRows", () => {
  it("maps assistant_text_delta to no rows (streaming handled separately)", () => {
    const event: TurnEvent = { type: "assistant_text_delta", text: "hello" };
    expect(eventToRows(event)).toEqual([]);
  });

  it("maps assistant_message with text to a transcript row", () => {
    const event: TurnEvent = {
      type: "assistant_message",
      message: { role: "assistant", content: "hello world" },
    };
    const rows = eventToRows(event);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ type: "assistant", text: "hello world" });
  });

  it("maps assistant_message with empty text to no rows", () => {
    const event: TurnEvent = {
      type: "assistant_message",
      message: { role: "assistant", content: "" },
    };
    expect(eventToRows(event)).toEqual([]);
  });

  it("maps tool_call to no rows", () => {
    const event: TurnEvent = {
      type: "tool_call",
      id: "tc1",
      name: "Read",
      input: { path: "a.ts" },
    };
    expect(eventToRows(event)).toEqual([]);
  });

  it("maps tool_started to a row with summary", () => {
    const event: TurnEvent = {
      type: "tool_started",
      id: "tc1",
      name: "bash",
      input: { command: "ls", intentKind: "fs_primitive" },
    };
    const rows = eventToRows(event);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("tool_started");
    if (rows[0].type === "tool_started") {
      expect(rows[0].tool).toBe("bash (fs_primitive)");
      expect(rows[0].summary).toContain("command");
    }
  });

  it("redacts sensitive tool_started input", () => {
    const event: TurnEvent = {
      type: "tool_started",
      id: "tc1",
      name: "write_file",
      input: { path: ".env", content: "SECRET=value" },
    };
    const rows = eventToRows(event, { sensitive: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("tool_started");
    if (rows[0].type === "tool_started") {
      expect(rows[0].summary).toContain("content: [...]");
      expect(rows[0].summary).not.toContain("SECRET=value");
    }
  });

  it("maps tool_result to a row", () => {
    const event: TurnEvent = {
      type: "tool_result",
      message: {
        role: "tool_result",
        toolCallId: "tc1",
        toolName: "Read",
        content: "file contents here",
      },
    };
    const rows = eventToRows(event);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      type: "tool_result",
      tool: "Read",
      content: "file contents here",
    });
  });

  it("maps tool_approval_required to an approval row", () => {
    const event: TurnEvent = {
      type: "tool_approval_required",
      id: "tc1",
      name: "edit_file",
      input: { path: "a.ts" },
      reason: "File write inside workspace",
      metadata: {
        realPath: "/tmp/ws/a.ts",
        additions: 5,
        deletions: 2,
      },
    };
    const rows = eventToRows(event);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("approval");
    if (rows[0].type === "approval") {
      expect(rows[0].tool).toBe("edit_file");
      expect(rows[0].reason).toBe("File write inside workspace");
      expect(rows[0].details).toContain("path: /tmp/ws/a.ts");
      expect(rows[0].details).toContain("changes: +5 -2");
    }
  });

  it("maps tool_approval_decision to a decision row", () => {
    const event: TurnEvent = {
      type: "tool_approval_decision",
      id: "tc1",
      name: "bash",
      decision: "allow",
    };
    const rows = eventToRows(event);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      type: "approval_decision",
      tool: "bash",
      decision: "allow",
    });
  });

  it("maps turn_truncated to a status row", () => {
    const event: TurnEvent = { type: "turn_truncated" };
    const rows = eventToRows(event);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      type: "status",
      kind: "truncated",
      text: "Turn truncated — model hit output token limit.",
    });
  });

  it("maps turn_max_turns to a status row", () => {
    const event: TurnEvent = { type: "turn_max_turns", maxTurns: 3 };
    const rows = eventToRows(event);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      type: "status",
      kind: "truncated",
      text: "Turn stopped after 3 tool steps without a final assistant message.",
    });
  });

  it("maps turn_finished to no rows", () => {
    const event: TurnEvent = { type: "turn_finished" };
    expect(eventToRows(event)).toEqual([]);
  });

  it("maps approval with sensitive metadata", () => {
    const event: TurnEvent = {
      type: "tool_approval_required",
      id: "tc1",
      name: "Read",
      input: { path: "secret", content: "SECRET=value" },
      reason: "Sensitive file",
      metadata: { sensitive: true },
    };
    const rows = eventToRows(event);
    expect(rows).toHaveLength(1);
    if (rows[0].type === "approval") {
      expect(rows[0].details).toContain("[sensitive]");
      expect(rows[0].details.join("\n")).toContain("content: [...]");
      expect(rows[0].details.join("\n")).not.toContain("SECRET=value");
    }
  });

  it("maps approval with external directory pattern", () => {
    const event: TurnEvent = {
      type: "tool_approval_required",
      id: "tc1",
      name: "bash",
      input: { command: "ls /other/project" },
      reason: "Outside workspace",
      metadata: {
        externalDirectoryPattern: "/other/project",
        externalDirectoryRoot: "/other/project",
      },
    };
    const rows = eventToRows(event);
    expect(rows).toHaveLength(1);
    if (rows[0].type === "approval") {
      expect(rows[0].details).toContain("grants: /other/project");
    }
  });
});
