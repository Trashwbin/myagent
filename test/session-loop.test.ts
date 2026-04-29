import { describe, it, expect } from "vitest";
import { FakeProvider } from "../src/model/fake.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { readFileTool } from "../src/tools/read.js";
import { bashTool } from "../src/tools/bash.js";
import { runSession } from "../src/session/loop.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
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
    expect(transcript[2].content).toContain("Blocked");
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
});
