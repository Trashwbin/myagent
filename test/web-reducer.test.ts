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
  it("tracks loaded projects and the active project", () => {
    const loaded = appReducer(initialAppState, {
      type: "projects_loaded",
      projects: [
        {
          path: "/tmp/a",
          name: "a",
          createdAt: 1,
          updatedAt: 1,
          sessionCount: 0,
        },
        {
          path: "/tmp/b",
          name: "b",
          createdAt: 2,
          updatedAt: 2,
          sessionCount: 1,
          current: true,
        },
      ],
      currentProjectPath: "/tmp/b",
    });

    expect(loaded.activeProjectPath).toBe("/tmp/b");

    const selected = appReducer(loaded, {
      type: "set_active_project",
      projectPath: "/tmp/a",
    });

    expect(selected.activeProjectPath).toBe("/tmp/a");
    expect(selected.projects).toEqual([
      expect.objectContaining({ path: "/tmp/a", current: true }),
      expect.objectContaining({ path: "/tmp/b", current: false }),
    ]);
  });

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

  it("replays write_file create diffs from stored tool input when old display has no files", () => {
    const messages: Message[] = [
      { role: "user", content: "create note" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tc1",
            name: "write_file",
            input: { path: "note.txt", content: "hello\nworld\n" },
            display: {
              kind: "mutation",
              title: "Write file",
              subtitle: "note.txt",
            },
          },
        ],
      },
      {
        role: "tool_result",
        toolCallId: "tc1",
        toolName: "write_file",
        content: "Wrote note.txt",
        toolDisplay: {
          kind: "mutation",
          title: "Write file",
          subtitle: "note.txt",
          summary: "completed",
          details: "Wrote note.txt",
        },
      },
    ];

    const turns = buildTimelineFromMessages(messages);

    expect(turns[0]?.mutationDiffs).toHaveLength(1);
    expect(turns[0]?.mutationDiffs[0]).toMatchObject({
      path: "note.txt",
      additions: 2,
      deletions: 0,
    });
    expect(turns[0]?.mutationDiffs[0]?.diff).toContain("+hello");
  });

  it("does not replay write_file create diffs for sensitive paths", () => {
    const messages: Message[] = [
      { role: "user", content: "create env" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tc1",
            name: "write_file",
            input: { path: ".env", content: "TOKEN=secret\n" },
          },
        ],
      },
      {
        role: "tool_result",
        toolCallId: "tc1",
        toolName: "write_file",
        content: "Wrote .env",
        toolDisplay: {
          kind: "mutation",
          title: "Write file",
          subtitle: ".env",
          summary: "completed",
        },
      },
    ];

    const turns = buildTimelineFromMessages(messages);

    expect(turns[0]?.mutationDiffs).toHaveLength(0);
  });

  it("turn events collapse streaming text into the final assistant message", () => {
    const initial = buildTimelineFromMessages([{ role: "user", content: "hi" }]);
    const events: TurnEvent[] = [
      { type: "assistant_text_started" },
      { type: "assistant_text_delta", text: "Hello" },
      { type: "assistant_text_delta", text: " there" },
      { type: "assistant_text_finished" },
      {
        type: "assistant_message",
        message: { role: "assistant", content: "Hello there" },
      },
    ];

    const result = events.reduce(
      (timeline, event) => applyTurnEvent(timeline, event),
      initial,
    );
    const textParts =
      result[0]?.assistantParts.filter((part) => part.kind === "text") ?? [];

    expect(textParts).toHaveLength(1);
    expect(textParts[0]).toMatchObject({ text: "Hello there" });
    expect("streaming" in textParts[0]!).toBe(false);
  });

  it("consumes stream boundary events without leaving status noise", () => {
    const initial = buildTimelineFromMessages([{ role: "user", content: "hi" }]);
    const events: TurnEvent[] = [
      { type: "provider_stream_started" },
      { type: "provider_step_started" },
      { type: "assistant_reasoning_started" },
      { type: "assistant_reasoning_finished" },
      { type: "assistant_text_started" },
      { type: "assistant_text_delta", text: "Hello" },
      { type: "assistant_text_finished" },
      { type: "provider_step_finished" },
    ];

    const result = events.reduce(
      (timeline, event) => applyTurnEvent(timeline, event),
      initial,
    );
    const parts = result[0]?.assistantParts ?? [];

    expect(parts.filter((part) => part.kind === "status")).toHaveLength(0);
    expect(parts).toMatchObject([{ kind: "text", text: "Hello", streaming: false }]);
  });

  it("keeps context tools as context-kind parts and mutation tools as mutation-kind parts", () => {
    const initial = buildTimelineFromMessages([
      { role: "user", content: "inspect and edit" },
    ]);
    const events: TurnEvent[] = [
      { type: "tool_started", id: "read1", name: "Read", input: { path: "a.ts" } },
      {
        type: "tool_result",
        message: {
          role: "tool_result",
          toolCallId: "read1",
          toolName: "Read",
          content: "1: const a = 1;",
        },
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

    const result = events.reduce(
      (timeline, event) => applyTurnEvent(timeline, event),
      initial,
    );
    const tools = result[0]?.assistantParts.filter((part) => part.kind === "tool") ?? [];

    expect(tools[0]).toMatchObject({ displayKind: "context" });
    expect(tools[1]).toMatchObject({ displayKind: "mutation" });
    expect(result[0]?.mutationDiffs).toHaveLength(1);
  });

  it("does not duplicate approval dock messages as separate tool parts", () => {
    const loaded = appReducer(initialAppState, {
      type: "timeline_loaded",
      sessionId: "s1",
      messages: [{ role: "user", content: "run command" }],
    });
    const state = appReducer(loaded, {
      type: "server_message",
      message: {
        type: "turn_event",
        sessionId: "s1",
        event: {
          type: "tool_approval_required",
          id: "tc1",
          name: "bash",
          input: { command: "python3 -m http.server 8000" },
          reason: "This shell command needs approval.",
        },
      },
    });

    const withDock = appReducer(state, {
      type: "server_message",
      message: {
        type: "approval_required",
        sessionId: "s1",
        approvalId: "approval-1",
        request: {
          toolName: "bash",
          input: { command: "python3 -m http.server 8000" },
          reason: "This shell command needs approval.",
        },
      },
    });
    const afterStarted = appReducer(withDock, {
      type: "server_message",
      message: {
        type: "turn_event",
        sessionId: "s1",
        event: {
          type: "tool_started",
          id: "tc1",
          name: "bash",
          input: { command: "python3 -m http.server 8000" },
        },
      },
    });
    const done = appReducer(afterStarted, {
      type: "server_message",
      message: {
        type: "turn_event",
        sessionId: "s1",
        event: {
          type: "tool_result",
          message: {
            role: "tool_result",
            toolCallId: "tc1",
            toolName: "bash",
            content: "Command completed with no output: python3 -m http.server 8000",
          },
        },
      },
    });

    const tools =
      done.timelines.s1?.[0]?.assistantParts.filter((part) => part.kind === "tool") ?? [];
    expect(withDock.pendingApproval?.approvalId).toBe("approval-1");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      id: "tc1",
      displayKind: "shell",
      status: "ok",
      subtitle: "python3 -m http.server 8000",
    });
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

  it("updates session metadata when the model changes", () => {
    const state = {
      ...initialAppState,
      sessions: [
        {
          id: "s1",
          workspaceRoot: "/tmp/ws",
          modelProfileId: "mimo/first",
          provider: "mimo",
          model: "first",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      timelines: buildTimelineFromMessages([{ role: "user", content: "/model second" }]),
      runningSessionIds: ["s1"],
    };

    const next = appReducer(state, {
      type: "server_message",
      message: {
        type: "session_model_changed",
        sessionId: "s1",
        modelProfileId: "mimo-claude/second",
        provider: "mimo-claude",
        model: "second",
        message: "Switched model to mimo-claude/second.",
      },
    });

    expect(next.sessions[0]).toMatchObject({
      modelProfileId: "mimo-claude/second",
      provider: "mimo-claude",
      model: "second",
    });
    expect(next.timelines.s1?.[0]?.assistantParts.at(-1)).toMatchObject({
      kind: "status",
      level: "info",
      text: "Switched model to mimo-claude/second.",
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
