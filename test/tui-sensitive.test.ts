import { describe, expect, it } from "vitest";
import { eventToRows } from "../src/tui/mapping.js";
import type { TurnEvent } from "../src/session/loop.js";

describe("sensitive redaction in TUI rows", () => {
  it("redacts sensitive tool_started content field", () => {
    const event: TurnEvent = {
      type: "tool_started",
      id: "tc1",
      name: "write_file",
      input: { path: ".env", content: "API_KEY=sk-secret123" },
    };
    const rows = eventToRows(event, { sensitive: true });
    expect(rows).toHaveLength(1);
    if (rows[0].type === "tool_started") {
      expect(rows[0].summary).toContain("content: [...]");
      expect(rows[0].summary).not.toContain("sk-secret123");
    }
  });

  it("shows content in non-sensitive tool_started", () => {
    const event: TurnEvent = {
      type: "tool_started",
      id: "tc1",
      name: "edit_file",
      input: { path: "app.ts", old_string: "hello", new_string: "world" },
    };
    const rows = eventToRows(event);
    expect(rows).toHaveLength(1);
    if (rows[0].type === "tool_started") {
      expect(rows[0].summary).toContain("hello");
    }
  });

  it("redacts sensitive approval input summary", () => {
    const event: TurnEvent = {
      type: "tool_approval_required",
      id: "tc1",
      name: "write_file",
      input: { path: ".env", content: "API_KEY=sk-secret" },
      reason: "Sensitive file",
      metadata: { sensitive: true },
    };
    const rows = eventToRows(event);
    expect(rows).toHaveLength(1);
    if (rows[0].type === "approval") {
      expect(rows[0].details.join("\n")).toContain("[sensitive]");
      expect(rows[0].details.join("\n")).toContain("content: [...]");
      expect(rows[0].details.join("\n")).not.toContain("sk-secret");
    }
  });

  it("non-sensitive approval shows input summary", () => {
    const event: TurnEvent = {
      type: "tool_approval_required",
      id: "tc1",
      name: "edit_file",
      input: { path: "app.ts", old_string: "old", new_string: "new" },
      reason: "File write inside workspace",
      metadata: {},
    };
    const rows = eventToRows(event);
    expect(rows).toHaveLength(1);
    if (rows[0].type === "approval") {
      expect(rows[0].details.join("\n")).not.toContain("[sensitive]");
    }
  });
});
