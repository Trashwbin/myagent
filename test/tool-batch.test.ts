import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolBatchView } from "../src/app/web/components/session/parts/ToolBatchView.js";
import {
  batchAssistantParts,
  summarizeBatch,
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

  it("summarizes explored, ran, and edited counts", () => {
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
    ).toBe("explored 1 file, ran 1 command, edited 2 files");
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
});
