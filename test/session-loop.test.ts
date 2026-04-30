import { describe, it, expect } from "vitest";
import { FakeProvider } from "../src/model/fake.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { readFileTool } from "../src/tools/read.js";
import { editFileTool } from "../src/tools/edit.js";
import { bashTool } from "../src/tools/bash.js";
import { runSession } from "../src/session/loop.js";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Session loop", () => {
  it("consumes text_delta events", async () => {
    const provider = new FakeProvider([
      [
        { type: "text_delta", text: "Hello, " },
        { type: "text_delta", text: "world!" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const { transcript } = await runSession(
      provider,
      new ToolRegistry(),
      [{ role: "user", content: "hi" }],
      { cwd: process.cwd(), approval: "auto" },
    );

    expect(transcript).toHaveLength(2);
    expect(transcript[0]).toEqual({ role: "user", content: "hi" });
    expect(transcript[1]).toEqual({
      role: "assistant",
      content: "Hello, world!",
      toolCalls: undefined,
    });
  });

  it("executes allowed tool_call", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-test-"));
    await writeFile(join(tmp, "hello.txt"), "hello world");

    const provider = new FakeProvider([
      [
        { type: "tool_call", id: "tc1", name: "read_file", input: { path: "hello.txt" } },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "I read the file." },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const { transcript } = await runSession(
      provider,
      registry,
      [{ role: "user", content: "read hello.txt" }],
      { cwd: tmp, approval: "auto" },
    );

    expect(transcript).toHaveLength(4);
    expect(transcript[1].role).toBe("assistant");
    expect(transcript[2]).toMatchObject({
      role: "tool_result",
      toolCallId: "tc1",
      content: "hello world",
    });
    expect(transcript[3]).toMatchObject({
      role: "assistant",
      content: "I read the file.",
    });

    await rm(tmp, { recursive: true });
  });

  it("blocks denied tool_call", async () => {
    const provider = new FakeProvider([
      [
        { type: "tool_call", id: "tc2", name: "bash", input: { command: "rm -rf /" } },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "ok" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(bashTool);

    const { transcript } = await runSession(
      provider,
      registry,
      [{ role: "user", content: "delete everything" }],
      { cwd: process.cwd(), approval: "auto" },
    );

    expect(transcript[2]).toMatchObject({
      role: "tool_result",
      toolCallId: "tc2",
    });
    expect(transcript[2].content).toContain("denied and was not executed");
  });

  it("transcript contains assistant text and tool results", async () => {
    const provider = new FakeProvider([
      [
        { type: "text_delta", text: "Let me check." },
        { type: "tool_call", id: "tc3", name: "bash", input: { command: "echo hello" } },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "Done." },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(bashTool);

    const { transcript } = await runSession(
      provider,
      registry,
      [{ role: "user", content: "echo hello" }],
      { cwd: process.cwd(), approval: "auto" },
    );

    expect(transcript).toHaveLength(4);
    expect(transcript[1].content).toBe("Let me check.");
    expect(transcript[1].toolCalls).toHaveLength(1);
    expect(transcript[2].content).toContain("hello");
    expect(transcript[3].content).toBe("Done.");
  });

  it("does not execute tool when ask and no approvalHandler", async () => {
    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc4",
          name: "edit_file",
          input: { path: "a.txt", old_string: "x", new_string: "y" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "ok" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(editFileTool);

    const tmp = await mkdtemp(join(tmpdir(), "myagent-test-"));
    await writeFile(join(tmp, "a.txt"), "x");

    const { transcript } = await runSession(
      provider,
      registry,
      [{ role: "user", content: "edit a.txt" }],
      { cwd: tmp, approval: "auto" },
    );

    expect(transcript[2].content).toContain("requires approval");
    expect(transcript[2].content).toContain("was not executed");

    // File should be unchanged
    const content = await readFile(join(tmp, "a.txt"), "utf-8");
    expect(content).toBe("x");

    await rm(tmp, { recursive: true });
  });

  it("executes edit_file when approvalHandler allows", async () => {
    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc5",
          name: "edit_file",
          input: { path: "a.txt", old_string: "old", new_string: "new" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(editFileTool);

    const tmp = await mkdtemp(join(tmpdir(), "myagent-test-"));
    await writeFile(join(tmp, "a.txt"), "old");

    const { transcript } = await runSession(
      provider,
      registry,
      [{ role: "user", content: "edit a.txt" }],
      {
        cwd: tmp,
        approval: "auto",
        approvalHandler: async () => "allow",
      },
    );

    expect(transcript[2].content).toContain("Edited a.txt");
    expect(transcript[2].content).toContain("[checkpoint:");

    // File should be changed
    const content = await readFile(join(tmp, "a.txt"), "utf-8");
    expect(content).toBe("new");

    await rm(tmp, { recursive: true });
  });

  it("does not execute edit_file when approvalHandler denies", async () => {
    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc6",
          name: "edit_file",
          input: { path: "a.txt", old_string: "x", new_string: "y" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "ok" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(editFileTool);

    const tmp = await mkdtemp(join(tmpdir(), "myagent-test-"));
    await writeFile(join(tmp, "a.txt"), "x");

    const { transcript } = await runSession(
      provider,
      registry,
      [{ role: "user", content: "edit a.txt" }],
      {
        cwd: tmp,
        approval: "auto",
        approvalHandler: async () => "deny",
      },
    );

    expect(transcript[2].content).toContain("denied and was not executed");

    // File should be unchanged
    const content = await readFile(join(tmp, "a.txt"), "utf-8");
    expect(content).toBe("x");

    await rm(tmp, { recursive: true });
  });

  it("checkpoint allows restoring after approved edit", async () => {
    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc7",
          name: "edit_file",
          input: { path: "data.txt", old_string: "v1", new_string: "v2" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "edited" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(editFileTool);

    const tmp = await mkdtemp(join(tmpdir(), "myagent-test-"));
    await writeFile(join(tmp, "data.txt"), "v1");

    const { transcript } = await runSession(
      provider,
      registry,
      [{ role: "user", content: "edit data.txt" }],
      {
        cwd: tmp,
        approval: "auto",
        approvalHandler: async () => "allow",
      },
    );

    // Extract checkpoint id from transcript
    const match = transcript[2].content.match(/\[checkpoint: ([^\]]+)\]/);
    expect(match).toBeTruthy();

    // File is now v2
    expect(await readFile(join(tmp, "data.txt"), "utf-8")).toBe("v2");

    // Restore checkpoint
    const { restoreCheckpoint } = await import("../src/workspace/checkpoint.js");
    await restoreCheckpoint(tmp, match![1]);

    // File is back to v1
    expect(await readFile(join(tmp, "data.txt"), "utf-8")).toBe("v1");

    await rm(tmp, { recursive: true });
  });
});
