import { describe, expect, it } from "vitest";
import {
  appReducer,
  applyTurnEvent,
  buildTimelineFromMessages,
  initialAppState,
} from "../src/app/web/state/reducer.js";
import type { Message } from "../src/model/types.js";
import type { TurnEvent } from "../src/session/loop.js";

describe("web timeline reducer", () => {
  it("rebuilds a turn from stored messages", () => {
    const messages: Message[] = [
      { role: "user", content: "edit app.ts" },
      {
        role: "assistant",
        content: "I will update it.",
        toolCalls: [{ id: "tc1", name: "edit_file", input: { path: "app.ts" } }],
      },
      {
        role: "tool_result",
        toolCallId: "tc1",
        toolName: "edit_file",
        content:
          "Edited app.ts (1 additions, 1 deletions)\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old\n+new",
      },
    ];

    const turns = buildTimelineFromMessages(messages);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.userMessage.text).toBe("edit app.ts");
    expect(turns[0]?.assistantParts.some((part) => part.kind === "text")).toBe(true);
    expect(turns[0]?.mutationDiffs).toHaveLength(1);
    expect(turns[0]?.mutationDiffs[0]?.path).toBe("app.ts");
  });

  it("turn events collapse streaming text into the final assistant message", () => {
    const initial = buildTimelineFromMessages([{ role: "user", content: "hi" }]);
    const events: TurnEvent[] = [
      { type: "assistant_text_delta", text: "Hello" },
      { type: "assistant_text_delta", text: " there" },
      {
        type: "assistant_message",
        message: { role: "assistant", content: "Hello there" },
      },
    ];

    const result = events.reduce((timeline, event) => applyTurnEvent(timeline, event), initial);
    const textParts = result[0]?.assistantParts.filter((part) => part.kind === "text") ?? [];

    expect(textParts).toHaveLength(1);
    expect(textParts[0]).toMatchObject({ text: "Hello there" });
    expect("streaming" in textParts[0]!).toBe(false);
  });

  it("keeps context tools as context-kind parts and mutation tools as mutation-kind parts", () => {
    const initial = buildTimelineFromMessages([{ role: "user", content: "inspect and edit" }]);
    const events: TurnEvent[] = [
      { type: "tool_started", id: "read1", name: "Read", input: { path: "a.ts" } },
      {
        type: "tool_result",
        message: { role: "tool_result", toolCallId: "read1", toolName: "Read", content: "1: const a = 1;" },
      },
      { type: "tool_started", id: "edit1", name: "edit_file", input: { path: "a.ts" } },
      {
        type: "tool_result",
        message: {
          role: "tool_result",
          toolCallId: "edit1",
          toolName: "edit_file",
          content:
            "Edited a.ts (1 additions, 1 deletions)\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;",
        },
      },
    ];

    const result = events.reduce((timeline, event) => applyTurnEvent(timeline, event), initial);
    const tools = result[0]?.assistantParts.filter((part) => part.kind === "tool") ?? [];

    expect(tools[0]).toMatchObject({ displayKind: "context" });
    expect(tools[1]).toMatchObject({ displayKind: "mutation" });
    expect(result[0]?.mutationDiffs).toHaveLength(1);
  });

  it("appends a status part when a session is rewound", () => {
    const state = appReducer(initialAppState, {
      type: "timeline_loaded",
      sessionId: "s1",
      messages: [{ role: "user", content: "edit" }],
    });

    const next = appReducer(state, {
      type: "server_message",
      message: {
        type: "session_rewound",
        sessionId: "s1",
        checkpointId: "cp1",
        files: [{ path: "a.txt", existed: true }],
        message: "rewind restored checkpoint cp1",
      },
    });

    expect(next.timelines.s1?.[0]?.assistantParts.at(-1)).toMatchObject({
      kind: "status",
      level: "info",
      text: "rewind restored checkpoint cp1",
    });
  });

  it("appends a status part when a session is compacted", () => {
    const loaded = appReducer(initialAppState, {
      type: "timeline_loaded",
      sessionId: "s1",
      messages: [{ role: "user", content: "continue" }],
    });
    const state = appReducer(loaded, {
      type: "session_running",
      sessionId: "s1",
      running: true,
    });

    const next = appReducer(state, {
      type: "server_message",
      message: {
        type: "session_compacted",
        sessionId: "s1",
        compactedCount: 4,
        retainedCount: 2,
        message: "Compacted 4 messages; retained 2 messages.",
      },
    });

    expect(next.timelines.s1?.[0]?.assistantParts.at(-1)).toMatchObject({
      kind: "status",
      level: "info",
      text: "Compacted 4 messages; retained 2 messages.",
    });
    expect(next.runningSessionIds).not.toContain("s1");
  });

  it("appends a local slash-command status", () => {
    const state = appReducer(initialAppState, {
      type: "timeline_loaded",
      sessionId: "s1",
      messages: [{ role: "user", content: "continue" }],
    });

    const next = appReducer(state, {
      type: "status_local",
      sessionId: "s1",
      level: "warning",
      text: "/rewind requires checkpointId. Usage: /rewind <checkpointId>",
    });

    expect(next.timelines.s1?.[0]?.assistantParts.at(-1)).toMatchObject({
      kind: "status",
      level: "warning",
      text: "/rewind requires checkpointId. Usage: /rewind <checkpointId>",
    });
  });
});
