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
  it("tracks loaded projects without deriving an active project", () => {
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
        },
      ],
    });

    expect(loaded.projects.map((project) => project.path)).toEqual(["/tmp/a", "/tmp/b"]);
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
    expect(turns[0]?.completed).toBe(true);
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

  it("turn events stream text through durable lifecycle parts", () => {
    const initial = buildTimelineFromMessages([{ role: "user", content: "hi" }]);
    const events: TurnEvent[] = [
      {
        type: "part_started",
        messageId: "m1",
        partId: "p1",
        partType: "text",
        phase: "commentary",
        status: "running",
      },
      { type: "part_delta", partId: "p1", delta: "Hello" },
      { type: "part_delta", partId: "p1", delta: " there" },
      { type: "part_finished", partId: "p1", status: "completed", phase: "final" },
    ];

    const result = events.reduce(
      (timeline, event) => applyTurnEvent(timeline, event),
      initial,
    );
    const textParts =
      result[0]?.assistantParts.filter((part) => part.kind === "text") ?? [];

    expect(textParts).toHaveLength(1);
    expect(textParts[0]).toMatchObject({ text: "Hello there" });
    expect(textParts[0]).toMatchObject({ streaming: false });
  });

  it("consumes durable part lifecycle events for streaming assistant text", () => {
    const initial = buildTimelineFromMessages([{ role: "user", content: "hi" }]);
    const events: TurnEvent[] = [
      {
        type: "message_started",
        messageId: "m1",
        role: "assistant",
        status: "running",
      },
      {
        type: "part_started",
        messageId: "m1",
        partId: "p1",
        partType: "text",
        phase: "commentary",
        status: "running",
      },
      { type: "part_delta", partId: "p1", delta: "Hello" },
      { type: "part_delta", partId: "p1", delta: " there" },
      {
        type: "part_finished",
        partId: "p1",
        status: "completed",
        phase: "final",
      },
    ];

    const result = events.reduce(
      (timeline, event) => applyTurnEvent(timeline, event),
      initial,
    );

    expect(result[0]?.assistantParts).toMatchObject([
      {
        id: "p1",
        kind: "text",
        text: "Hello there",
        phase: "final",
        status: "completed",
        streaming: false,
      },
    ]);
  });

  it("stores context usage by session from turn usage events", () => {
    const result = appReducer(initialAppState, {
      type: "server_message",
      message: {
        type: "turn_event",
        sessionId: "s1",
        event: {
          type: "turn_usage_updated",
          usage: {
            inputTokens: 78000,
            outputTokens: 1200,
            totalTokens: 79200,
          },
        },
      },
    });

    expect(result.sessionContextUsage.s1).toMatchObject({
      source: "provider",
      usedTokens: 79200,
      lastUsage: {
        inputTokens: 78000,
        outputTokens: 1200,
        totalTokens: 79200,
      },
    });
  });

  it("rebuilds context usage from stored assistant usage", () => {
    const result = appReducer(
      {
        ...initialAppState,
        providerConfig: {
          current: "mimo/mimo-v2.5-pro",
          providers: [],
          models: [
            {
              id: "mimo/mimo-v2.5-pro",
              provider: "mimo",
              providerID: "mimo",
              modelID: "mimo-v2.5-pro",
              adapter: "@ai-sdk/openai-compatible",
              model: "mimo-v2.5-pro",
              contextWindow: 1048576,
            },
          ],
        },
        sessions: [
          {
            id: "s1",
            projectPath: "/tmp/ws",
            modelProfileId: "mimo/mimo-v2.5-pro",
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      },
      {
        type: "timeline_loaded",
        sessionId: "s1",
        messages: [
          { role: "user", content: "hi" },
          {
            role: "assistant",
            content: "hello",
            usage: {
              inputTokens: 200000,
              outputTokens: 1000,
              totalTokens: 201000,
            },
          },
        ],
      },
    );

    expect(result.sessionContextUsage.s1).toMatchObject({
      contextWindow: 1048576,
      source: "provider",
      usedTokens: 201000,
      percentFull: 19,
    });
  });

  it("uses explicit assistant phases instead of guessing final text from position", () => {
    const initial = buildTimelineFromMessages([{ role: "user", content: "inspect" }]);
    const events: TurnEvent[] = [
      {
        type: "part_started",
        messageId: "m1",
        partId: "p1",
        partType: "text",
        phase: "commentary",
        status: "completed",
        text: "I will inspect first.",
      },
      {
        type: "part_started",
        messageId: "m1",
        partId: "read1",
        partType: "tool-call",
        status: "completed",
        toolCallId: "read1",
        toolName: "Read",
        input: { path: "src/app-main.ts" },
      },
      {
        type: "part_finished",
        partId: "read1",
        status: "completed",
        output: '1: import { createAppServer } from "./app/server.js";',
      },
      {
        type: "part_started",
        messageId: "m2",
        partId: "p2",
        partType: "text",
        phase: "final",
        status: "completed",
        text: "The final answer.",
      },
    ];

    const result = events.reduce(
      (timeline, event) => applyTurnEvent(timeline, event),
      initial,
    );
    const textParts =
      result[0]?.assistantParts.filter((part) => part.kind === "text") ?? [];

    expect(textParts).toMatchObject([
      { text: "I will inspect first.", phase: "commentary" },
      { text: "The final answer.", phase: "final" },
    ]);
  });

  it("hydrates failed partial assistant output with an error status", () => {
    const turns = buildTimelineFromMessages([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "partial answer",
        status: "failed",
        error: "terminated",
        parts: [
          {
            type: "text",
            text: "partial answer",
            phase: "commentary",
            status: "interrupted",
          },
        ],
      },
    ]);

    expect(turns[0]?.assistantParts).toMatchObject([
      {
        kind: "text",
        text: "partial answer",
        phase: "commentary",
        status: "interrupted",
      },
      {
        kind: "status",
        level: "error",
        text: "Turn failed: terminated",
      },
    ]);
  });

  it("does not mark a turn complete when only assistant text streaming finishes", () => {
    const initial = buildTimelineFromMessages([{ role: "user", content: "hi" }]);
    const streamingFinished = [
      {
        type: "part_started",
        messageId: "m1",
        partId: "p1",
        partType: "text",
        status: "running",
      },
      { type: "part_delta", partId: "p1", delta: "I will inspect this." },
      { type: "part_finished", partId: "p1", status: "completed" },
    ].reduce((timeline, event) => applyTurnEvent(timeline, event as TurnEvent), initial);

    expect(streamingFinished[0]?.completed).toBe(false);
    expect(streamingFinished[0]?.completedAt).toBeUndefined();

    const turnFinished = applyTurnEvent(streamingFinished, { type: "turn_finished" });

    expect(turnFinished[0]?.completed).toBe(true);
    expect(turnFinished[0]?.completedAt).toBeTypeOf("number");
  });

  it("consumes reasoning and text lifecycle events without leaving status noise", () => {
    const initial = buildTimelineFromMessages([{ role: "user", content: "hi" }]);
    const events: TurnEvent[] = [
      {
        type: "part_started",
        messageId: "m1",
        partId: "r1",
        partType: "reasoning",
        status: "running",
      },
      { type: "part_delta", partId: "r1", delta: "Think." },
      { type: "part_finished", partId: "r1", status: "completed" },
      {
        type: "part_started",
        messageId: "m1",
        partId: "p1",
        partType: "text",
        phase: "commentary",
        status: "running",
      },
      { type: "part_delta", partId: "p1", delta: "Hello" },
      { type: "part_finished", partId: "p1", status: "completed" },
    ];

    const result = events.reduce(
      (timeline, event) => applyTurnEvent(timeline, event),
      initial,
    );
    const parts = result[0]?.assistantParts ?? [];

    expect(parts.filter((part) => part.kind === "status")).toHaveLength(0);
    expect(parts).toMatchObject([
      { kind: "text", text: "Think.", streaming: false },
      { kind: "text", text: "Hello", streaming: false, phase: "commentary" },
    ]);
  });

  it("keeps context tools as context-kind parts and mutation tools as mutation-kind parts", () => {
    const initial = buildTimelineFromMessages([
      { role: "user", content: "inspect and edit" },
    ]);
    const events: TurnEvent[] = [
      {
        type: "part_started",
        messageId: "m1",
        partId: "read1",
        partType: "tool-call",
        status: "completed",
        toolCallId: "read1",
        toolName: "Read",
        input: { path: "a.ts" },
      },
      {
        type: "part_finished",
        partId: "read1",
        status: "completed",
        output: "1: const a = 1;",
      },
      {
        type: "part_started",
        messageId: "m1",
        partId: "edit1",
        partType: "tool-call",
        status: "completed",
        toolCallId: "edit1",
        toolName: "edit_file",
        input: { path: "a.ts" },
      },
      {
        type: "part_finished",
        partId: "edit1",
        status: "completed",
        output:
          "Edited a.ts (1 additions, 1 deletions)\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;",
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

  it("keeps checkpoint ids from lifecycle tool-result parts", () => {
    const initial = buildTimelineFromMessages([
      { role: "user", content: "edit with checkpoint" },
    ]);
    const events: TurnEvent[] = [
      {
        type: "part_started",
        messageId: "m1",
        partId: "edit1",
        partType: "tool-call",
        status: "completed",
        toolCallId: "edit1",
        toolName: "edit_file",
        input: { path: "a.ts" },
      },
      {
        type: "part_started",
        messageId: "m2",
        partId: "stored-result-part-1",
        partType: "tool-result",
        status: "completed",
        toolCallId: "edit1",
        toolName: "edit_file",
        output:
          "Edited a.ts (1 additions, 1 deletions)\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;",
        metadata: { checkpointId: "cp-live" },
      },
      {
        type: "part_finished",
        partId: "stored-result-part-1",
        status: "completed",
        output:
          "Edited a.ts (1 additions, 1 deletions)\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;",
        metadata: { checkpointId: "cp-live" },
      },
    ];

    const result = events.reduce(
      (timeline, event) => applyTurnEvent(timeline, event),
      initial,
    );
    const tool = result[0]?.assistantParts.find(
      (part) => part.kind === "tool" && part.id === "edit1",
    );

    expect(tool).toMatchObject({ checkpointId: "cp-live" });
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
    const done = appReducer(withDock, {
      type: "server_message",
      message: {
        type: "turn_event",
        sessionId: "s1",
        event: {
          type: "part_finished",
          partId: "tc1",
          status: "completed",
          output: "Command completed with no output: python3 -m http.server 8000",
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

  it("appends a compaction boundary when a session is compacted", () => {
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
        summary: "Older context summary",
        beforeTokens: 12_000,
        afterTokens: 4_000,
        previousSummaryUsed: false,
        transcriptTruncated: false,
        createdAt: 123,
      },
    });

    expect(next.timelines.s1?.[0]?.assistantParts.at(-1)).toMatchObject({
      kind: "compaction",
      summary: "Older context summary",
      compactedCount: 4,
      retainedCount: 2,
      beforeTokens: 12_000,
      afterTokens: 4_000,
    });
    expect(next.runningSessionIds).not.toContain("s1");
  });

  it("keeps a session running when auto compaction fires before a turn", () => {
    const state = {
      ...initialAppState,
      timelines: {
        s1: buildTimelineFromMessages([{ role: "user", content: "continue" }]),
      },
      runningSessionIds: ["s1"],
    };

    const next = appReducer(state, {
      type: "server_message",
      message: {
        type: "session_compacted",
        sessionId: "s1",
        compactedCount: 4,
        retainedCount: 2,
        message: "Compacted 4 messages; retained 2 messages.",
        summary: "Older context summary",
        auto: true,
        reason: "context_limit",
      },
    });

    expect(next.runningSessionIds).toContain("s1");
    expect(next.timelines.s1?.[0]?.assistantParts.at(-1)).toMatchObject({
      kind: "compaction",
      auto: true,
      reason: "context_limit",
    });
  });

  it("rebuilds compaction boundaries from stored summary messages", () => {
    const timeline = buildTimelineFromMessages([
      {
        role: "summary",
        content: "Older context summary",
        parts: [
          {
            type: "compaction",
            summary: "Older context summary",
            compactedCount: 6,
            retainedCount: 3,
            beforeTokens: 20_000,
            afterTokens: 6_000,
            createdAt: 456,
          },
        ],
      },
      { role: "user", content: "continue" },
      { role: "assistant", content: "final" },
    ]);

    expect(timeline[0]?.assistantParts[0]).toMatchObject({
      kind: "compaction",
      summary: "Older context summary",
      compactedCount: 6,
      retainedCount: 3,
      beforeTokens: 20_000,
      afterTokens: 6_000,
    });
    expect(timeline[0]?.userMessage.text).toBe("");
    expect(timeline[1]?.userMessage.text).toBe("continue");
  });

  it("updates session metadata when the model changes", () => {
    const state = {
      ...initialAppState,
      sessions: [
        {
          id: "s1",
          projectPath: "/tmp/ws",
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
