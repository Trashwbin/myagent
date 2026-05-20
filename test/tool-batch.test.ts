import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolBatchView } from "../src/app/web/components/session/parts/ToolBatchView.js";
import { TurnToolTrace } from "../src/app/web/components/session/parts/TurnToolTrace.js";
import { splitTurnAssistantParts } from "../src/app/web/components/session/SessionTurn.js";
import { buildTimelineFromMessages } from "../src/app/web/state/reducer.js";
import {
  batchIconName,
  batchAssistantParts,
  summarizeBatch,
  summarizeToolTrace,
} from "../src/app/web/components/session/parts/tool-batch.js";

describe("tool batch", () => {
  it("groups contiguous tool parts by display kind", () => {
    const result = batchAssistantParts([
      {
        id: "t1",
        kind: "tool",
        toolName: "Read",
        displayKind: "context",
        status: "ok",
        title: "Read",
      },
      {
        id: "t2",
        kind: "tool",
        toolName: "bash",
        displayKind: "shell",
        status: "ok",
        title: "Bash",
      },
      { id: "m1", kind: "text", text: "done" },
    ]);

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      kind: "batch",
      tools: [{ displayKind: "context" }],
    });
    expect(result[1]).toMatchObject({ kind: "batch", tools: [{ displayKind: "shell" }] });
    expect(result[2]).toMatchObject({ kind: "part" });
  });

  it("marks batches active while queued/running/approval tools exist", () => {
    const result = batchAssistantParts([
      {
        id: "t1",
        kind: "tool",
        toolName: "bash",
        displayKind: "shell",
        status: "running",
        title: "Bash",
      },
    ]);

    expect(result[0]).toMatchObject({ kind: "batch", active: true });
  });

  it("summarizes explored, loaded skills, ran, and edited counts", () => {
    expect(
      summarizeBatch([
        {
          id: "t1",
          kind: "tool",
          toolName: "Read",
          displayKind: "context",
          status: "ok",
          title: "Read",
        },
        {
          id: "t2",
          kind: "tool",
          toolName: "bash",
          displayKind: "shell",
          status: "ok",
          title: "Bash",
        },
        {
          id: "skill1",
          kind: "tool",
          toolName: "skill",
          displayKind: "skill",
          status: "ok",
          title: "Load skill",
          subtitle: "say-hello",
        },
        {
          id: "t3",
          kind: "tool",
          toolName: "write_file",
          displayKind: "mutation",
          status: "ok",
          title: "Write file",
        },
        {
          id: "t4",
          kind: "tool",
          toolName: "edit_file",
          displayKind: "mutation",
          status: "ok",
          title: "Edit file",
        },
      ]),
    ).toBe("explored 1 file, loaded 1 skill, ran 1 command, edited 2 files");
  });

  it("uses a skill icon instead of search for skill-only batches", () => {
    const tools = [
      {
        id: "skill1",
        kind: "tool" as const,
        toolName: "skill",
        displayKind: "skill" as const,
        status: "ok" as const,
        title: "Load skill",
        subtitle: "say-hello",
      },
    ];

    expect(batchIconName(tools)).toBe("skill");
  });

  it("summarizes a whole turn tool trace by operation type", () => {
    expect(
      summarizeToolTrace([
        {
          id: "read1",
          kind: "tool",
          toolName: "Read",
          displayKind: "context",
          status: "ok",
          title: "Read",
        },
        {
          id: "list1",
          kind: "tool",
          toolName: "list_dir",
          displayKind: "context",
          status: "ok",
          title: "List directory",
        },
        {
          id: "skill1",
          kind: "tool",
          toolName: "skill",
          displayKind: "skill",
          status: "ok",
          title: "Load skill",
          subtitle: "say-hello",
        },
        {
          id: "bash1",
          kind: "tool",
          toolName: "bash",
          displayKind: "shell",
          status: "ok",
          title: "Bash",
        },
        {
          id: "edit1",
          kind: "tool",
          toolName: "write_file",
          displayKind: "mutation",
          status: "ok",
          title: "Write file",
          diffFiles: [
            { path: "a.ts", additions: 1, deletions: 0 },
            { path: "b.ts", additions: 2, deletions: 1 },
          ],
        },
      ]),
    ).toBe("1 read, 1 browse, 1 skill, 1 command, 2 files edited");
  });

  it("renders expanded skill batches with a visible child row", () => {
    const html = renderToStaticMarkup(
      React.createElement(ToolBatchView, {
        active: false,
        collapsed: false,
        tools: [
          {
            id: "skill1",
            kind: "tool",
            toolName: "skill",
            displayKind: "skill",
            status: "ok",
            title: "Load skill",
            subtitle: "say-hello",
            summary: "loaded",
          },
        ],
      }),
    );

    expect(html).toContain("loaded 1 skill");
    expect(html).toContain("Load skill");
    expect(html).toContain("say-hello");
    expect(html).toContain("loaded");
    expect(html).toContain("#icon-prompt");
    expect(html.match(/#icon-prompt/g)).toHaveLength(2);
  });

  it("keeps completed shell batches collapsed to a single summary row", () => {
    const html = renderToStaticMarkup(
      React.createElement(ToolBatchView, {
        active: false,
        collapsed: true,
        tools: [
          {
            id: "bash1",
            kind: "tool",
            toolName: "bash",
            displayKind: "shell",
            status: "ok",
            title: "Bash",
            subtitle: "python3 -m http.server 8000",
          },
          {
            id: "bash2",
            kind: "tool",
            toolName: "bash",
            displayKind: "shell",
            status: "ok",
            title: "Bash",
            subtitle: "curl http://localhost:8000/",
          },
        ],
      }),
    );

    expect(html).toContain("Ran 2 commands");
    expect(html).not.toContain("Ran python3 -m http.server 8000");
    expect(html).not.toContain("curl http://localhost:8000/");
  });

  it("collapses completed turn tool traces behind one worked row", () => {
    const html = renderToStaticMarkup(
      React.createElement(TurnToolTrace, {
        turn: {
          id: "turn1",
          userMessage: { id: "user1", text: "build" },
          createdAt: 1_000,
          completedAt: 391_000,
          completed: true,
          mutationDiffs: [],
          assistantParts: [
            {
              id: "read1",
              kind: "tool",
              toolName: "Read",
              displayKind: "context",
              status: "ok",
              title: "Read",
              subtitle: "src/app.ts",
            },
            {
              id: "bash1",
              kind: "tool",
              toolName: "bash",
              displayKind: "shell",
              status: "ok",
              title: "Bash",
              subtitle: "pnpm test",
            },
          ],
        },
      }),
    );

    expect(html).toContain("Worked for 6m 30s");
    expect(html).toContain("1 read, 1 command");
    expect(html).toContain('<details class="turn-tool-trace">');
    expect(html).not.toContain('<details class="turn-tool-trace" open="">');
  });

  it("keeps pre-tool assistant text inside the worked trace and only final text outside", () => {
    const split = splitTurnAssistantParts([
      {
        id: "intro",
        kind: "text",
        text: "I will inspect these files first.",
      },
      {
        id: "read1",
        kind: "tool",
        toolName: "Read",
        displayKind: "context",
        status: "ok",
        title: "Read",
        subtitle: "src/cli.ts",
      },
      {
        id: "final",
        kind: "text",
        text: "Here is the first batch summary.",
      },
    ]);

    expect(split.traceParts).toMatchObject([
      { kind: "text", text: "I will inspect these files first." },
      { kind: "tool", title: "Read" },
    ]);
    expect(split.finalParts).toMatchObject([
      { kind: "text", text: "Here is the first batch summary." },
    ]);

    const html = renderToStaticMarkup(
      React.createElement(TurnToolTrace, {
        turn: {
          id: "turn1",
          userMessage: { id: "user1", text: "execute" },
          createdAt: 1_000,
          completedAt: 3_000,
          completed: true,
          mutationDiffs: [],
          assistantParts: split.traceParts,
        },
      }),
    );

    expect(html).toContain("I will inspect these files first.");
    expect(html).not.toContain("Here is the first batch summary.");
  });

  it("splits stored assistant text with tool calls from the later final assistant reply", () => {
    const [turn] = buildTimelineFromMessages([
      { role: "user", content: "execute" },
      {
        role: "assistant",
        content: "I will inspect these files first.",
        toolCalls: [{ id: "read1", name: "Read", input: { path: "src/cli.ts" } }],
      },
      {
        role: "tool_result",
        toolCallId: "read1",
        toolName: "Read",
        content: "1: import React from \"react\";",
      },
      {
        role: "assistant",
        content: "Here is the first batch summary.",
      },
    ]);

    const split = splitTurnAssistantParts(turn?.assistantParts ?? []);

    expect(split.traceParts).toMatchObject([
      { kind: "text", text: "I will inspect these files first." },
      { kind: "tool", title: "Read", status: "ok" },
    ]);
    expect(split.finalParts).toMatchObject([
      { kind: "text", text: "Here is the first batch summary." },
    ]);
  });
});
