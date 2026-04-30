import { describe, it, expect } from "vitest";
import { FakeProvider } from "../src/model/fake.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { readFileTool } from "../src/tools/read.js";
import { editFileTool } from "../src/tools/edit.js";
import { bashTool } from "../src/tools/bash.js";
import { runSession, runTurn } from "../src/session/loop.js";
import type { Provider } from "../src/model/provider.js";
import type { ModelEvent, Message, ToolSchema } from "../src/model/types.js";
import type { ProviderStreamOptions } from "../src/model/provider.js";
import type { SessionState } from "../src/session/loop.js";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

describe("Session loop (runSession wrapper)", () => {
  it("passes the system prompt to the provider", async () => {
    let capturedOptions: ProviderStreamOptions | undefined;
    const provider: Provider = {
      name: "capture",
      async *stream(
        _messages: Message[],
        _tools?: ToolSchema[],
        options?: ProviderStreamOptions,
      ): AsyncGenerator<ModelEvent> {
        capturedOptions = options;
        yield { type: "text_delta", text: "ok" };
        yield { type: "stop", reason: "end_turn" };
      },
    };

    await runSession(provider, new ToolRegistry(), [{ role: "user", content: "hi" }], {
      cwd: "/tmp/myagent-workspace",
      approval: "auto",
    });

    expect(capturedOptions?.systemPrompt).toContain(
      "The workspace root is: /tmp/myagent-workspace",
    );
    expect(capturedOptions?.systemPrompt).toContain(
      "Modify existing files only with edit_file",
    );
  });

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
        { type: "tool_call", id: "tc3", name: "bash", input: { command: "pwd" } },
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
    expect(transcript[2].content).toBeTruthy();
    expect(transcript[3].content).toBe("Done.");
  });

  it("preserves initial history before continuing", async () => {
    let capturedMessages: Message[] = [];
    const provider: Provider = {
      name: "capture",
      async *stream(messages: Message[]): AsyncGenerator<ModelEvent> {
        capturedMessages = [...messages];
        yield { type: "text_delta", text: "continued" };
        yield { type: "stop", reason: "end_turn" };
      },
    };

    const initialMessages: Message[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "second" },
    ];

    const { transcript } = await runSession(
      provider,
      new ToolRegistry(),
      initialMessages,
      { cwd: process.cwd(), approval: "auto" },
    );

    expect(capturedMessages.map((m) => m.content)).toEqual([
      "first",
      "first answer",
      "second",
    ]);
    expect(transcript.map((m) => m.content)).toEqual([
      "first",
      "first answer",
      "second",
      "continued",
    ]);
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

    const match = transcript[2].content.match(/\[checkpoint: ([^\]]+)\]/);
    expect(match).toBeTruthy();

    expect(await readFile(join(tmp, "data.txt"), "utf-8")).toBe("v2");

    const { restoreCheckpoint } = await import("../src/workspace/checkpoint.js");
    await restoreCheckpoint(tmp, match![1]);

    expect(await readFile(join(tmp, "data.txt"), "utf-8")).toBe("v1");

    await rm(tmp, { recursive: true });
  });
});

describe("runTurn", () => {
  function makeSession(cwd: string, messages: Message[] = []): SessionState {
    return { id: randomUUID(), cwd, messages };
  }

  it("appends user input to session.messages", async () => {
    const provider = new FakeProvider([
      [
        { type: "text_delta", text: "hi" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const session = makeSession(process.cwd());
    const { session: updated, newMessages } = await runTurn(
      provider,
      new ToolRegistry(),
      session,
      "hello",
      { approval: "auto" },
    );

    expect(updated.messages).toHaveLength(2);
    expect(updated.messages[0]).toEqual({ role: "user", content: "hello" });
    expect(updated.messages[1].content).toBe("hi");
  });

  it("returns only new messages in newMessages", async () => {
    const provider = new FakeProvider([
      [
        { type: "text_delta", text: "response" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const history: Message[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: "first answer" },
    ];
    const session = makeSession(process.cwd(), history);

    const { newMessages } = await runTurn(
      provider,
      new ToolRegistry(),
      session,
      "second",
      {
        approval: "auto",
      },
    );

    // newMessages should only contain: user("second") + assistant("response")
    expect(newMessages).toHaveLength(2);
    expect(newMessages[0]).toEqual({ role: "user", content: "second" });
    expect(newMessages[1].content).toBe("response");
  });

  it("second turn receives first turn history", async () => {
    const capturedMessages: Message[][] = [];

    const provider: Provider = {
      name: "spy",
      async *stream(messages: Message[]): AsyncGenerator<ModelEvent> {
        capturedMessages.push([...messages]);
        yield { type: "text_delta", text: "ok" };
        yield { type: "stop", reason: "end_turn" };
      },
    };

    const registry = new ToolRegistry();
    const session = makeSession(process.cwd());

    const turn1 = await runTurn(provider, registry, session, "first", {
      approval: "auto",
    });
    const turn2 = await runTurn(provider, registry, turn1.session, "second", {
      approval: "auto",
    });

    // First turn: provider sees [user("first")]
    expect(capturedMessages[0]).toHaveLength(1);
    expect(capturedMessages[0][0].content).toBe("first");

    // Second turn: provider sees [user("first"), assistant("ok"), user("second")]
    expect(capturedMessages[1]).toHaveLength(3);
    expect(capturedMessages[1][0].content).toBe("first");
    expect(capturedMessages[1][1].role).toBe("assistant");
    expect(capturedMessages[1][2].content).toBe("second");

    // Final session has all 4 messages
    expect(turn2.session.messages).toHaveLength(4);
  });

  it("preserves existing messages across turns", async () => {
    const provider = new FakeProvider([
      [
        { type: "text_delta", text: "t1" },
        { type: "stop", reason: "end_turn" },
      ],
      [
        { type: "text_delta", text: "t2" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const registry = new ToolRegistry();
    const session = makeSession(process.cwd());

    const r1 = await runTurn(provider, registry, session, "a", { approval: "auto" });
    const r2 = await runTurn(provider, registry, r1.session, "b", { approval: "auto" });

    // Turn 1: user + assistant = 2 messages
    expect(r1.session.messages).toHaveLength(2);

    // Turn 2: user + assistant added = 4 messages total
    expect(r2.session.messages).toHaveLength(4);
    expect(r2.session.messages.map((m) => m.content)).toEqual(["a", "t1", "b", "t2"]);
  });
});
