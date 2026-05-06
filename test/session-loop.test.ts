import { describe, it, expect, afterEach } from "vitest";
import { FakeProvider } from "../src/model/fake.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { readFileTool } from "../src/tools/read.js";
import { editFileTool } from "../src/tools/edit.js";
import { writeFileTool } from "../src/tools/write.js";
import { bashTool } from "../src/tools/bash.js";
import { listDirTool } from "../src/tools/list-dir.js";
import { searchTool } from "../src/tools/search.js";
import { applyPatchTool } from "../src/tools/apply-patch.js";
import { ReadStateTracker } from "../src/tools/file-mutation.js";
import { runSession, runTurn } from "../src/session/loop.js";
import type { TurnEvent } from "../src/session/loop.js";
import type { Provider } from "../src/model/provider.js";
import type { ModelEvent, Message, ToolSchema } from "../src/model/types.js";
import type { ProviderStreamOptions } from "../src/model/provider.js";
import type { SessionState } from "../src/session/loop.js";
import type { ApprovalRule } from "../src/permission/approval.js";
import { openStore } from "../src/storage/store.js";
import type { TranscriptStore } from "../src/storage/store.js";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

let activeStores: TranscriptStore[] = [];

afterEach(() => {
  for (const s of activeStores) s.close();
  activeStores = [];
});

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
    expect(capturedOptions?.systemPrompt).toContain("edit_file");
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
        { type: "tool_call", id: "tc1", name: "Read", input: { path: "hello.txt" } },
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
      content: "1: hello world",
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
      { cwd: tmp, approval: "on-request" },
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
        approvalHandler: async () => "allow_once",
      },
    );

    expect(transcript[2].content).toContain("Edited a.txt");
    expect(transcript[2].content).not.toContain("[checkpoint:");
    expect(transcript[2].checkpointId).toBeTruthy();

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
        approval: "on-request",
        approvalHandler: async () => "abort",
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
        approvalHandler: async () => "allow_once",
      },
    );

    expect(transcript[2].content).not.toContain("[checkpoint:");
    expect(transcript[2].checkpointId).toBeTruthy();

    expect(await readFile(join(tmp, "data.txt"), "utf-8")).toBe("v2");

    const { restoreCheckpoint } = await import("../src/workspace/checkpoint.js");
    await restoreCheckpoint(tmp, transcript[2].checkpointId!);

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
    const { session: updated } = await runTurn(
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

// --- TurnEvent ordering ---

describe("TurnEvent ordering", () => {
  function makeSession(cwd: string, messages: Message[] = []): SessionState {
    return { id: randomUUID(), cwd, messages };
  }

  function captureEvents(): { events: TurnEvent[]; onEvent: (e: TurnEvent) => void } {
    const events: TurnEvent[] = [];
    return {
      events,
      onEvent: (e: TurnEvent) => {
        events.push(e);
      },
    };
  }

  it("emits assistant_text_delta before assistant_message", async () => {
    const provider = new FakeProvider([
      [
        { type: "text_delta", text: "Hello" },
        { type: "text_delta", text: " world" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const { events, onEvent } = captureEvents();
    await runTurn(provider, new ToolRegistry(), makeSession(process.cwd()), "hi", {
      approval: "auto",
      onEvent,
    });

    const types = events.map((e) => e.type);
    const firstDelta = types.indexOf("assistant_text_delta");
    const firstMsg = types.indexOf("assistant_message");
    expect(firstDelta).toBeLessThan(firstMsg);
    expect(firstDelta).toBe(0);

    const finished = types.indexOf("turn_finished");
    expect(finished).toBe(types.length - 1);
  });

  it("emits tool_approval_required before approvalHandler resolves", async () => {
    let handlerCalled = false;

    const provider = new FakeProvider([
      [
        { type: "tool_call", id: "tc1", name: "bash", input: { command: "touch x.txt" } },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(bashTool);

    const tmp = await mkdtemp(join(tmpdir(), "myagent-test-"));
    const { events, onEvent } = captureEvents();

    await runTurn(provider, registry, makeSession(tmp), "touch", {
      approval: "auto",
      approvalHandler: async () => {
        handlerCalled = true;
        return "allow_once";
      },
      onEvent,
    });

    const types = events.map((e) => e.type);
    const reqIdx = types.indexOf("tool_approval_required");
    const decIdx = types.indexOf("tool_approval_decision");
    expect(reqIdx).toBeGreaterThanOrEqual(0);
    expect(reqIdx).toBeLessThan(decIdx);
    expect(handlerCalled).toBe(true);

    await rm(tmp, { recursive: true });
  });

  it("emits tool_started only after approval allow", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-test-"));

    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "bash",
          input: { command: "touch approved.txt" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "ok" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(bashTool);

    const { events, onEvent } = captureEvents();
    await runTurn(provider, registry, makeSession(tmp), "touch", {
      approval: "auto",
      approvalHandler: async () => "allow_once",
      onEvent,
    });

    const types = events.map((e) => e.type);
    const decIdx = types.indexOf("tool_approval_decision");
    const startedIdx = types.indexOf("tool_started");
    expect(decIdx).toBeGreaterThanOrEqual(0);
    expect(decIdx).toBeLessThan(startedIdx);

    await rm(tmp, { recursive: true });
  });

  it("emits tool_result immediately after tool execution", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-test-"));
    await writeFile(join(tmp, "f.txt"), "hi");

    const provider = new FakeProvider([
      [
        { type: "tool_call", id: "tc1", name: "Read", input: { path: "f.txt" } },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const { events, onEvent } = captureEvents();
    await runTurn(provider, registry, makeSession(tmp), "read", {
      approval: "auto",
      onEvent,
    });

    const types = events.map((e) => e.type);
    const startedIdx = types.indexOf("tool_started");
    const resultIdx = types.indexOf("tool_result");
    expect(startedIdx).toBeLessThan(resultIdx);

    const resultEvent = events[resultIdx] as Extract<TurnEvent, { type: "tool_result" }>;
    expect(resultEvent.message.content).toBe("1: hi");
    expect(resultEvent.display).toMatchObject({
      kind: "context",
      title: "Read",
      subtitle: "f.txt",
      summary: "1 lines",
    });

    await rm(tmp, { recursive: true });
  });

  it("emits structured display on tool_call and tool_started", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-test-"));

    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "write_file",
          input: { path: "note.txt", content: "hello" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(writeFileTool);

    const { events, onEvent } = captureEvents();
    const { newMessages } = await runTurn(provider, registry, makeSession(tmp), "write", {
      approval: "auto",
      approvalHandler: async () => "allow_once",
      onEvent,
    });

    const call = events.find((event) => event.type === "tool_call") as Extract<
      TurnEvent,
      { type: "tool_call" }
    >;
    const started = events.find((event) => event.type === "tool_started") as Extract<
      TurnEvent,
      { type: "tool_started" }
    >;

    expect(call.display).toMatchObject({
      kind: "mutation",
      title: "Write file",
      subtitle: "note.txt",
    });
    expect(started.display).toMatchObject({
      kind: "mutation",
      title: "Write file",
      subtitle: "note.txt",
    });
    expect(newMessages[1]?.role).toBe("assistant");
    expect(newMessages[1]?.toolCalls?.[0]).toMatchObject({
      name: "write_file",
      display: {
        kind: "mutation",
        title: "Write file",
        subtitle: "note.txt",
      },
    });
    const resultMessage = newMessages.find(
      (message) => message.role === "tool_result" && message.toolName === "write_file",
    );
    expect(resultMessage?.toolDisplay).toMatchObject({
      kind: "mutation",
      title: "Write file",
      subtitle: "note.txt",
    });

    await rm(tmp, { recursive: true });
  });

  it("denied tool emits tool_approval_decision and tool_result", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-test-"));

    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "bash",
          input: { command: "touch denied.txt" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "ok" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(bashTool);

    const { events, onEvent } = captureEvents();
    await runTurn(provider, registry, makeSession(tmp), "touch", {
      approval: "auto",
      approvalHandler: async () => "abort",
      onEvent,
    });

    const types = events.map((e) => e.type);
    expect(types).toContain("tool_approval_required");
    expect(types).toContain("tool_approval_decision");
    expect(types).toContain("tool_result");
    expect(types).not.toContain("tool_started");

    const decIdx = types.indexOf("tool_approval_decision");
    const resultIdx = types.indexOf("tool_result");
    expect(decIdx).toBeLessThan(resultIdx);

    await rm(tmp, { recursive: true });
  });

  it("existing transcript still matches after events", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-test-"));
    await writeFile(join(tmp, "test.txt"), "hello");

    const provider = new FakeProvider([
      [
        { type: "text_delta", text: "Reading." },
        { type: "tool_call", id: "tc1", name: "Read", input: { path: "test.txt" } },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "Done." },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const { events, onEvent } = captureEvents();
    const session = makeSession(tmp);

    const { session: updated, newMessages } = await runTurn(
      provider,
      registry,
      session,
      "read test.txt",
      { approval: "auto", onEvent },
    );

    // Transcript integrity
    expect(updated.messages).toHaveLength(4);
    expect(updated.messages[1].content).toBe("Reading.");
    expect(updated.messages[2].content).toBe("1: hello");
    expect(updated.messages[3].content).toBe("Done.");

    // newMessages is subset
    expect(newMessages).toHaveLength(4);

    // Events were emitted
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("assistant_text_delta");
    expect(types).toContain("tool_call");
    expect(types).toContain("assistant_message");
    expect(types).toContain("tool_result");
    expect(types[types.length - 1]).toBe("turn_finished");

    await rm(tmp, { recursive: true });
  });

  it("tool_approval_required event includes metadata", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-test-"));
    const sibling = `${tmp}-sibling`;
    await mkdir(sibling);
    await writeFile(join(sibling, "data.txt"), "sibling data");

    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "Read",
          input: { path: `../${sibling.split("/").at(-1)}/data.txt` },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const { events, onEvent } = captureEvents();
    await runTurn(provider, registry, makeSession(tmp), "read", {
      approval: "auto",
      approvalHandler: async () => "allow_once",
      onEvent,
    });

    const approvalEvent = events.find((e) => e.type === "tool_approval_required");
    expect(approvalEvent).toBeDefined();
    expect((approvalEvent as any).metadata).toBeDefined();
    expect((approvalEvent as any).metadata.insideWorkspace).toBe(false);
    expect((approvalEvent as any).metadata.realPath).toBeTruthy();

    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult).toBeDefined();
    expect((toolResult as any).message.content).toContain("sibling data");

    await rm(tmp, { recursive: true, force: true });
    await rm(sibling, { recursive: true, force: true });
  });
});

// --- Approval memory and abort ---

describe("Approval memory and abort", () => {
  function makeSession(cwd: string, messages: Message[] = []): SessionState {
    return { id: randomUUID(), cwd, messages };
  }

  async function tmpDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "myagent-approval-test-"));
    return dir;
  }

  function openTestStore(baseDir: string): TranscriptStore {
    const store = openStore({ baseDir });
    activeStores.push(store);
    return store;
  }

  it("allow_once does not write any rule", async () => {
    const tmp = await tmpDir();
    await writeFile(join(tmp, "f.txt"), "hello");

    const sessionRules: ApprovalRule[] = [];
    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "edit_file",
          input: { path: "f.txt", old_string: "hello", new_string: "world" },
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

    await runTurn(provider, registry, makeSession(tmp), "edit", {
      approval: "auto",
      approvalHandler: async () => "allow_once",
      sessionApprovalRules: sessionRules,
    });

    expect(sessionRules).toHaveLength(0);
    await rm(tmp, { recursive: true, force: true });
  });

  it("allow_for_session auto-allows matching second request", async () => {
    const tmp = await tmpDir();
    await writeFile(join(tmp, "f.txt"), "content");

    const sessionRules: ApprovalRule[] = [];
    const registry = new ToolRegistry();
    registry.register(editFileTool);

    let handlerCalled = 0;
    const handler = async () => {
      handlerCalled++;
      return "allow_for_session" as const;
    };

    // First call: triggers approval handler (on-request mode)
    const provider1 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "edit_file",
          input: { path: "f.txt", old_string: "content", new_string: "v1" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    const session = makeSession(tmp);
    const r1 = await runTurn(provider1, registry, session, "edit", {
      approval: "on-request",
      approvalHandler: handler,
      sessionApprovalRules: sessionRules,
    });
    expect(handlerCalled).toBe(1);
    expect(sessionRules).toHaveLength(1);

    // Second call: same tool+pattern, should NOT trigger handler
    const provider2 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc2",
          name: "edit_file",
          input: { path: "f.txt", old_string: "v1", new_string: "v2" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    const r2 = await runTurn(provider2, registry, r1.session, "edit again", {
      approval: "on-request",
      approvalHandler: handler,
      sessionApprovalRules: sessionRules,
    });
    expect(handlerCalled).toBe(1); // Not called again
    expect(r2.newMessages.find((m) => m.role === "tool_result")?.content).toContain(
      "Edited f.txt",
    );

    await rm(tmp, { recursive: true, force: true });
  });

  it("allow_for_workspace writes to SQLite and auto-allows in new session", async () => {
    const tmp = await tmpDir();
    const storeBase = await tmpDir();
    const store = openTestStore(storeBase);
    await writeFile(join(tmp, "f.txt"), "content");

    const registry = new ToolRegistry();
    registry.register(editFileTool);

    // First session: approve for workspace (on-request mode)
    const provider1 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "edit_file",
          input: { path: "f.txt", old_string: "content", new_string: "v1" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    const session1 = makeSession(tmp);
    await runTurn(provider1, registry, session1, "edit", {
      approval: "on-request",
      approvalHandler: async () => "allow_for_workspace",
      sessionApprovalRules: [],
      store,
    });

    // Rule was persisted
    const rules = store.listPermissionRules(tmp);
    expect(rules).toHaveLength(1);
    expect(rules[0].toolName).toBe("edit_file");

    // Second session, same workspace: should auto-allow without handler
    await writeFile(join(tmp, "f.txt"), "v1");
    const provider2 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc2",
          name: "edit_file",
          input: { path: "f.txt", old_string: "v1", new_string: "v2" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    let handlerCalled = false;
    const session2 = makeSession(tmp);
    const r2 = await runTurn(provider2, registry, session2, "edit again", {
      approval: "on-request",
      approvalHandler: async () => {
        handlerCalled = true;
        return "allow_once";
      },
      sessionApprovalRules: [],
      store,
    });
    expect(handlerCalled).toBe(false);
    expect(r2.newMessages.find((m) => m.role === "tool_result")?.content).toContain(
      "Edited f.txt",
    );

    await rm(tmp, { recursive: true, force: true });
    await rm(storeBase, { recursive: true, force: true });
  });

  it("different workspace does not reuse workspace rule", async () => {
    const tmp1 = await tmpDir();
    const tmp2 = await tmpDir();
    const storeBase = await tmpDir();
    const store = openTestStore(storeBase);

    await writeFile(join(tmp1, "f.txt"), "content");

    const registry = new ToolRegistry();
    registry.register(editFileTool);

    // Approve in workspace 1 (on-request mode so handler is invoked)
    const provider1 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "edit_file",
          input: { path: "f.txt", old_string: "content", new_string: "v1" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    await runTurn(provider1, registry, makeSession(tmp1), "edit", {
      approval: "on-request",
      approvalHandler: async () => "allow_for_workspace",
      sessionApprovalRules: [],
      store,
    });

    // Same tool in workspace 2: should NOT auto-allow via workspace rule
    await writeFile(join(tmp2, "f.txt"), "content");
    let handlerCalled = false;
    const provider2 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc2",
          name: "edit_file",
          input: { path: "f.txt", old_string: "content", new_string: "v2" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    await runTurn(provider2, registry, makeSession(tmp2), "edit", {
      approval: "on-request",
      approvalHandler: async () => {
        handlerCalled = true;
        return "allow_once";
      },
      sessionApprovalRules: [],
      store,
    });
    expect(handlerCalled).toBe(true);

    await rm(tmp1, { recursive: true, force: true });
    await rm(tmp2, { recursive: true, force: true });
    await rm(storeBase, { recursive: true, force: true });
  });

  it("abort terminates the turn", async () => {
    const tmp = await tmpDir();

    const provider = new FakeProvider([
      [
        { type: "tool_call", id: "tc1", name: "bash", input: { command: "touch x.txt" } },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "ok" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(bashTool);

    const { newMessages, aborted } = await runTurn(
      provider,
      registry,
      makeSession(tmp),
      "touch",
      { approval: "auto", approvalHandler: async () => "abort" },
    );

    expect(aborted).toBe(true);
    // Turn terminated: user + assistant(toolCall) + tool_result(blocked) = 3
    // No second assistant message ("ok") because turn was aborted
    expect(newMessages).toHaveLength(3);
    expect(newMessages[2].role).toBe("tool_result");
    expect(newMessages[2].content).toContain("denied");

    await rm(tmp, { recursive: true, force: true });
  });

  it("abort does not write permission_rules", async () => {
    const tmp = await tmpDir();
    const storeBase = await tmpDir();
    const store = openTestStore(storeBase);

    const provider = new FakeProvider([
      [
        { type: "tool_call", id: "tc1", name: "bash", input: { command: "touch x.txt" } },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "ok" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(bashTool);

    await runTurn(provider, registry, makeSession(tmp), "touch", {
      approval: "auto",
      approvalHandler: async () => "abort",
      sessionApprovalRules: [],
      store,
    });

    const rules = store.listPermissionRules(tmp);
    expect(rules).toHaveLength(0);

    await rm(tmp, { recursive: true, force: true });
    await rm(storeBase, { recursive: true, force: true });
  });

  it("edit_file still creates checkpoint when auto-allowed by session rule", async () => {
    const tmp = await tmpDir();
    await writeFile(join(tmp, "data.txt"), "v1");

    const sessionRules: ApprovalRule[] = [];
    const registry = new ToolRegistry();
    registry.register(editFileTool);

    // First edit: approve for session
    const provider1 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "edit_file",
          input: { path: "data.txt", old_string: "v1", new_string: "v2" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    const session = makeSession(tmp);
    const r1 = await runTurn(provider1, registry, session, "edit", {
      approval: "auto",
      approvalHandler: async () => "allow_for_session",
      sessionApprovalRules: sessionRules,
    });

    // Checkpoint was created on first edit
    const firstEdit = r1.newMessages.find((m) => m.role === "tool_result");
    expect(firstEdit?.content).not.toContain("[checkpoint:");
    expect(firstEdit?.checkpointId).toBeTruthy();

    // Second edit: auto-allowed by session rule, still gets checkpoint
    const provider2 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc2",
          name: "edit_file",
          input: { path: "data.txt", old_string: "v2", new_string: "v3" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    const r2 = await runTurn(provider2, registry, r1.session, "edit again", {
      approval: "auto",
      sessionApprovalRules: sessionRules,
    });

    const result = r2.newMessages.find((m) => m.role === "tool_result");
    expect(result?.content).toContain("Edited data.txt");
    expect(result?.content).not.toContain("[checkpoint:");
    expect(result?.checkpointId).toBeTruthy();

    await rm(tmp, { recursive: true, force: true });
  });

  it("persisted rule cannot override deny", async () => {
    const tmp = await tmpDir();
    const storeBase = await tmpDir();
    const store = openTestStore(storeBase);

    // Add a workspace rule for bash with "rm -rf /"
    store.addPermissionRule({
      workspaceRoot: tmp,
      toolName: "bash",
      pattern: "rm -rf /",
    });

    const provider = new FakeProvider([
      [
        { type: "tool_call", id: "tc1", name: "bash", input: { command: "rm -rf /" } },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "ok" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(bashTool);

    const { newMessages, aborted } = await runTurn(
      provider,
      registry,
      makeSession(tmp),
      "delete",
      { approval: "auto", store },
    );

    // Policy denies "rm -rf /" — rule cannot override
    const toolResult = newMessages.find((m) => m.role === "tool_result");
    expect(toolResult).toBeDefined();
    expect(toolResult!.content).toContain("denied");
    expect(aborted).toBeFalsy();

    await rm(tmp, { recursive: true, force: true });
    await rm(storeBase, { recursive: true, force: true });
  });

  // --- external_directory ---

  it("read_file: external_directory session rule auto-allows second file", async () => {
    const ws = await tmpDir();
    const ext = await tmpDir();
    await writeFile(join(ext, "a.txt"), "aaa");
    await writeFile(join(ext, "b.txt"), "bbb");

    const sessionRules: ApprovalRule[] = [];
    const registry = new ToolRegistry();
    registry.register(readFileTool);

    let handlerCalled = 0;
    const handler = async () => {
      handlerCalled++;
      return "allow_for_session" as const;
    };

    // First read: asks for approval
    const provider1 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "Read",
          input: { path: join(ext, "a.txt") },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    const session = makeSession(ws);
    const r1 = await runTurn(provider1, registry, session, "read external", {
      approval: "auto",
      approvalHandler: handler,
      sessionApprovalRules: sessionRules,
    });
    expect(handlerCalled).toBe(1);
    expect(r1.newMessages.find((m) => m.role === "tool_result")?.content).toBe("1: aaa");

    // External_directory rule was saved
    expect(sessionRules.some((r) => r.toolName === "external_directory")).toBe(true);

    // Second read: same directory, different file → auto-allowed
    const provider2 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc2",
          name: "Read",
          input: { path: join(ext, "b.txt") },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    const r2 = await runTurn(provider2, registry, r1.session, "read another", {
      approval: "auto",
      approvalHandler: handler,
      sessionApprovalRules: sessionRules,
    });
    expect(handlerCalled).toBe(1);
    expect(r2.newMessages.find((m) => m.role === "tool_result")?.content).toBe("1: bbb");

    await rm(ws, { recursive: true, force: true });
    await rm(ext, { recursive: true, force: true });
  });

  it("read_file: sibling external directory not matched by external_directory rule", async () => {
    const ws = await tmpDir();
    const ext1 = await tmpDir();
    const ext2 = await tmpDir();
    await writeFile(join(ext1, "a.txt"), "aaa");
    await writeFile(join(ext2, "b.txt"), "bbb");

    const sessionRules: ApprovalRule[] = [];
    const registry = new ToolRegistry();
    registry.register(readFileTool);

    let handlerCalled = 0;
    const handler = async () => {
      handlerCalled++;
      return "allow_for_session" as const;
    };

    // Approve ext1
    const provider1 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "Read",
          input: { path: join(ext1, "a.txt") },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    await runTurn(provider1, registry, makeSession(ws), "read", {
      approval: "auto",
      approvalHandler: handler,
      sessionApprovalRules: sessionRules,
    });
    expect(handlerCalled).toBe(1);

    // Read from ext2: should still ask (sibling not covered)
    const provider2 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc2",
          name: "Read",
          input: { path: join(ext2, "b.txt") },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    await runTurn(provider2, registry, makeSession(ws), "read", {
      approval: "auto",
      approvalHandler: handler,
      sessionApprovalRules: sessionRules,
    });
    expect(handlerCalled).toBe(2);

    await rm(ws, { recursive: true, force: true });
    await rm(ext1, { recursive: true, force: true });
    await rm(ext2, { recursive: true, force: true });
  });

  it("read_file: sensitive file in approved external dir still asks", async () => {
    const ws = await tmpDir();
    const ext = await tmpDir();
    await writeFile(join(ext, "a.txt"), "aaa");
    await writeFile(join(ext, ".env"), "SECRET=x");

    const sessionRules: ApprovalRule[] = [];
    const registry = new ToolRegistry();
    registry.register(readFileTool);

    let handlerCalled = 0;
    const handler = async () => {
      handlerCalled++;
      return "allow_for_session" as const;
    };

    // Approve directory via normal file
    const provider1 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "Read",
          input: { path: join(ext, "a.txt") },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    await runTurn(provider1, registry, makeSession(ws), "read", {
      approval: "auto",
      approvalHandler: handler,
      sessionApprovalRules: sessionRules,
    });
    expect(handlerCalled).toBe(1);

    // Read .env: external_directory rule should NOT auto-allow
    const provider2 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc2",
          name: "Read",
          input: { path: join(ext, ".env") },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    await runTurn(provider2, registry, makeSession(ws), "read env", {
      approval: "auto",
      approvalHandler: handler,
      sessionApprovalRules: sessionRules,
    });
    expect(handlerCalled).toBe(2);

    await rm(ws, { recursive: true, force: true });
    await rm(ext, { recursive: true, force: true });
  });

  it("list_dir: external_directory session rule auto-allows", async () => {
    const ws = await tmpDir();
    const ext = await tmpDir();
    await writeFile(join(ext, "file.txt"), "hi");

    const sessionRules: ApprovalRule[] = [];
    const registry = new ToolRegistry();
    registry.register(listDirTool);

    let handlerCalled = 0;
    const handler = async () => {
      handlerCalled++;
      return "allow_for_session" as const;
    };

    const provider1 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "list_dir",
          input: { path: ext },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    await runTurn(provider1, registry, makeSession(ws), "list", {
      approval: "auto",
      approvalHandler: handler,
      sessionApprovalRules: sessionRules,
    });
    expect(handlerCalled).toBe(1);

    // Second list_dir same dir → auto-allowed
    const provider2 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc2",
          name: "list_dir",
          input: { path: ext },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    await runTurn(provider2, registry, makeSession(ws), "list again", {
      approval: "auto",
      approvalHandler: handler,
      sessionApprovalRules: sessionRules,
    });
    expect(handlerCalled).toBe(1);

    await rm(ws, { recursive: true, force: true });
    await rm(ext, { recursive: true, force: true });
  });

  it("search: external_directory session rule auto-allows same dir", async () => {
    const ws = await tmpDir();
    const ext = await tmpDir();
    await writeFile(join(ext, "code.ts"), "TODO: fix");

    const sessionRules: ApprovalRule[] = [];
    const registry = new ToolRegistry();
    registry.register(searchTool);

    let handlerCalled = 0;
    const handler = async () => {
      handlerCalled++;
      return "allow_for_session" as const;
    };

    const provider1 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "grep",
          input: { pattern: "TODO", path: ext },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    await runTurn(provider1, registry, makeSession(ws), "search", {
      approval: "auto",
      approvalHandler: handler,
      sessionApprovalRules: sessionRules,
    });
    expect(handlerCalled).toBe(1);

    // Second search same dir → auto-allowed
    const provider2 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc2",
          name: "grep",
          input: { pattern: "fix", path: ext },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    const r2 = await runTurn(provider2, registry, makeSession(ws), "search again", {
      approval: "auto",
      approvalHandler: handler,
      sessionApprovalRules: sessionRules,
    });
    expect(handlerCalled).toBe(1);
    expect(r2.newMessages.find((m) => m.role === "tool_result")?.content).toContain(
      "code.ts",
    );

    await rm(ws, { recursive: true, force: true });
    await rm(ext, { recursive: true, force: true });
  });

  it("external_directory workspace rule persists and auto-allows in new session", async () => {
    const ws = await tmpDir();
    const ext = await tmpDir();
    const storeBase = await tmpDir();
    const store = openTestStore(storeBase);
    await writeFile(join(ext, "pkg.json"), '{"name":"test"}');

    const registry = new ToolRegistry();
    registry.register(readFileTool);

    // Session 1: approve external_directory for workspace
    const provider1 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "Read",
          input: { path: join(ext, "pkg.json") },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    await runTurn(provider1, registry, makeSession(ws), "read", {
      approval: "auto",
      approvalHandler: async () => "allow_for_workspace",
      sessionApprovalRules: [],
      store,
    });

    // Rule was persisted as external_directory
    const rules = store.listPermissionRules(ws);
    expect(rules).toHaveLength(1);
    expect(rules[0].toolName).toBe("external_directory");

    // Session 2, same workspace: auto-allows without handler
    await writeFile(join(ext, "other.txt"), "other");
    const provider2 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc2",
          name: "Read",
          input: { path: join(ext, "other.txt") },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    let handlerCalled = false;
    const r2 = await runTurn(provider2, registry, makeSession(ws), "read", {
      approval: "auto",
      approvalHandler: async () => {
        handlerCalled = true;
        return "allow_once";
      },
      sessionApprovalRules: [],
      store,
    });
    expect(handlerCalled).toBe(false);
    expect(r2.newMessages.find((m) => m.role === "tool_result")?.content).toBe("1: other");

    await rm(ws, { recursive: true, force: true });
    await rm(ext, { recursive: true, force: true });
    await rm(storeBase, { recursive: true, force: true });
  });

  it("external_directory rule from different workspace is not reused", async () => {
    const ws1 = await tmpDir();
    const ws2 = await tmpDir();
    const ext = await tmpDir();
    const storeBase = await tmpDir();
    const store = openTestStore(storeBase);
    await writeFile(join(ext, "shared.txt"), "data");

    const registry = new ToolRegistry();
    registry.register(readFileTool);

    // Approve in ws1
    const provider1 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "Read",
          input: { path: join(ext, "shared.txt") },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    await runTurn(provider1, registry, makeSession(ws1), "read", {
      approval: "auto",
      approvalHandler: async () => "allow_for_workspace",
      sessionApprovalRules: [],
      store,
    });

    // ws2 should NOT get the rule
    let handlerCalled = false;
    const provider2 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc2",
          name: "Read",
          input: { path: join(ext, "shared.txt") },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    await runTurn(provider2, registry, makeSession(ws2), "read", {
      approval: "auto",
      approvalHandler: async () => {
        handlerCalled = true;
        return "allow_once";
      },
      sessionApprovalRules: [],
      store,
    });
    expect(handlerCalled).toBe(true);

    await rm(ws1, { recursive: true, force: true });
    await rm(ws2, { recursive: true, force: true });
    await rm(ext, { recursive: true, force: true });
    await rm(storeBase, { recursive: true, force: true });
  });

  // --- Same-turn auto-resolution ---

  it("same-turn: multi read_file only asks once after project-root pattern", async () => {
    const ws = await tmpDir();
    const ext = await tmpDir();
    await mkdir(join(ext, "src", "permission"), { recursive: true });
    await mkdir(join(ext, "src", "session"), { recursive: true });
    await mkdir(join(ext, "src", "tools"), { recursive: true });
    await writeFile(join(ext, "package.json"), "{}");
    await writeFile(join(ext, "src", "permission", "a.ts"), "perm");
    await writeFile(join(ext, "src", "session", "b.ts"), "sess");
    await writeFile(join(ext, "src", "tools", "c.ts"), "tool");

    const sessionRules: ApprovalRule[] = [];
    const registry = new ToolRegistry();
    registry.register(readFileTool);

    let handlerCalled = 0;
    const handler = async () => {
      handlerCalled++;
      return "allow_for_session" as const;
    };

    // All 4 files in one assistant message
    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "Read",
          input: { path: join(ext, "src", "permission", "a.ts") },
        },
        {
          type: "tool_call",
          id: "tc2",
          name: "Read",
          input: { path: join(ext, "src", "session", "b.ts") },
        },
        {
          type: "tool_call",
          id: "tc3",
          name: "Read",
          input: { path: join(ext, "src", "tools", "c.ts") },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const { newMessages } = await runTurn(provider, registry, makeSession(ws), "read", {
      approval: "auto",
      approvalHandler: handler,
      sessionApprovalRules: sessionRules,
    });

    // Handler only called once for the first file
    expect(handlerCalled).toBe(1);

    // All three reads succeeded
    const results = newMessages.filter((m) => m.role === "tool_result");
    expect(results).toHaveLength(3);
    expect(results[0].content).toBe("1: perm");
    expect(results[1].content).toBe("1: sess");
    expect(results[2].content).toBe("1: tool");

    // One external_directory rule covering the project root
    expect(sessionRules.length).toBe(1);
    expect(sessionRules[0].toolName).toBe("external_directory");

    await rm(ws, { recursive: true, force: true });
    await rm(ext, { recursive: true, force: true });
  });

  it("same-turn: sensitive file still asks even with project-root pattern", async () => {
    const ws = await tmpDir();
    const ext = await tmpDir();
    await mkdir(join(ext, "src"), { recursive: true });
    await writeFile(join(ext, "package.json"), "{}");
    await writeFile(join(ext, "src", "a.ts"), "code");
    await writeFile(join(ext, ".env"), "SECRET=x");

    const sessionRules: ApprovalRule[] = [];
    const registry = new ToolRegistry();
    registry.register(readFileTool);

    let handlerCalled = 0;
    const handler = async () => {
      handlerCalled++;
      return "allow_for_session" as const;
    };

    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "Read",
          input: { path: join(ext, "src", "a.ts") },
        },
        {
          type: "tool_call",
          id: "tc2",
          name: "Read",
          input: { path: join(ext, ".env") },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const { newMessages } = await runTurn(provider, registry, makeSession(ws), "read", {
      approval: "auto",
      approvalHandler: handler,
      sessionApprovalRules: sessionRules,
    });

    // Handler called twice: once for a.ts, once for .env
    expect(handlerCalled).toBe(2);

    const results = newMessages.filter((m) => m.role === "tool_result");
    expect(results[0].content).toBe("1: code");
    expect(results[1].content).toBe("1: SECRET=x");

    await rm(ws, { recursive: true, force: true });
    await rm(ext, { recursive: true, force: true });
  });

  it("same-turn: bash external approval covers following read_file", async () => {
    const ws = await tmpDir();
    const ext = await tmpDir();
    await mkdir(join(ext, "src", "session"), { recursive: true });
    await writeFile(join(ext, "package.json"), "{}");
    await writeFile(join(ext, "src", "session", "loop.ts"), "loop code");

    const sessionRules: ApprovalRule[] = [];
    const registry = new ToolRegistry();
    registry.register(bashTool);
    registry.register(readFileTool);

    let handlerCalled = 0;
    const handler = async () => {
      handlerCalled++;
      return "allow_for_session" as const;
    };

    // bash cd && git diff, then read_file in same turn
    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "bash",
          input: { command: `cd ${ext} && git diff` },
        },
        {
          type: "tool_call",
          id: "tc2",
          name: "Read",
          input: { path: join(ext, "src", "session", "loop.ts") },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const { newMessages } = await runTurn(
      provider,
      registry,
      makeSession(ws),
      "inspect",
      {
        approval: "auto",
        approvalHandler: handler,
        sessionApprovalRules: sessionRules,
      },
    );

    // Handler called once for bash, read_file auto-allowed
    expect(handlerCalled).toBe(1);

    // Both tool results present
    const results = newMessages.filter((m) => m.role === "tool_result");
    expect(results).toHaveLength(2);
    expect(results[1].content).toBe("1: loop code");

    // Two rules: external_directory + bash pattern
    expect(sessionRules.some((r) => r.toolName === "external_directory")).toBe(true);
    expect(sessionRules.some((r) => r.toolName === "bash")).toBe(true);

    await rm(ws, { recursive: true, force: true });
    await rm(ext, { recursive: true, force: true });
  });

  it("bash: external_directory rule does not auto-allow sensitive files", async () => {
    const ws = await tmpDir();
    const ext = await tmpDir();
    await writeFile(join(ext, "package.json"), "{}");
    await writeFile(join(ext, ".env"), "SECRET=x");

    const sessionRules: ApprovalRule[] = [];
    const registry = new ToolRegistry();
    registry.register(bashTool);

    let handlerCalled = 0;
    const handler = async () => {
      handlerCalled++;
      return "allow_for_session" as const;
    };

    const provider1 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "bash",
          input: { command: `cd ${ext} && git diff` },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const session = makeSession(ws);
    const r1 = await runTurn(provider1, registry, session, "inspect", {
      approval: "auto",
      approvalHandler: handler,
      sessionApprovalRules: sessionRules,
    });
    expect(handlerCalled).toBe(1);
    expect(sessionRules.some((r) => r.toolName === "external_directory")).toBe(true);

    const provider2 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc2",
          name: "bash",
          input: { command: `cd ${ext} && cat .env` },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const r2 = await runTurn(provider2, registry, r1.session, "read env", {
      approval: "auto",
      approvalHandler: handler,
      sessionApprovalRules: sessionRules,
    });

    expect(handlerCalled).toBe(2);
    expect(r2.newMessages.find((m) => m.role === "tool_result")?.content).toContain(
      "SECRET=x",
    );

    await rm(ws, { recursive: true, force: true });
    await rm(ext, { recursive: true, force: true });
  });

  // --- Sensitive file approval: allow_once only, no persistence ---

  it("sensitive read_file .env: allow_once executes but writes no rules", async () => {
    const tmp = await tmpDir();
    await writeFile(join(tmp, ".env"), "SECRET=abc");

    const sessionRules: ApprovalRule[] = [];
    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "Read",
          input: { path: ".env" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const { newMessages } = await runTurn(
      provider,
      registry,
      makeSession(tmp),
      "read env",
      {
        approval: "auto",
        approvalHandler: async () => "allow_once",
        sessionApprovalRules: sessionRules,
      },
    );

    expect(newMessages.find((m) => m.role === "tool_result")?.content).toBe("1: SECRET=abc");
    expect(sessionRules).toHaveLength(0);

    await rm(tmp, { recursive: true, force: true });
  });

  it("sensitive read_file .env: allow_for_session downgraded, no rules saved", async () => {
    const tmp = await tmpDir();
    await writeFile(join(tmp, ".env"), "SECRET=abc");

    const sessionRules: ApprovalRule[] = [];
    const registry = new ToolRegistry();
    registry.register(readFileTool);

    let handlerCalled = 0;
    const handler = async () => {
      handlerCalled++;
      return "allow_for_session" as const;
    };

    // First read: approve with allow_for_session
    const provider1 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "Read",
          input: { path: ".env" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const session = makeSession(tmp);
    const r1 = await runTurn(provider1, registry, session, "read env", {
      approval: "auto",
      approvalHandler: handler,
      sessionApprovalRules: sessionRules,
    });

    expect(r1.newMessages.find((m) => m.role === "tool_result")?.content).toBe(
      "1: SECRET=abc",
    );
    expect(sessionRules).toHaveLength(0);

    // Second read: should still ask (no rule was saved)
    const provider2 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc2",
          name: "Read",
          input: { path: ".env" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    await runTurn(provider2, registry, r1.session, "read env again", {
      approval: "auto",
      approvalHandler: handler,
      sessionApprovalRules: sessionRules,
    });

    expect(handlerCalled).toBe(2);
    expect(sessionRules).toHaveLength(0);

    await rm(tmp, { recursive: true, force: true });
  });

  it("sensitive read_file .env: allow_for_workspace downgraded, no persistence", async () => {
    const tmp = await tmpDir();
    const storeBase = await tmpDir();
    const store = openTestStore(storeBase);
    await writeFile(join(tmp, ".env"), "SECRET=abc");

    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "Read",
          input: { path: ".env" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const { newMessages } = await runTurn(
      provider,
      registry,
      makeSession(tmp),
      "read env",
      {
        approval: "auto",
        approvalHandler: async () => "allow_for_workspace",
        sessionApprovalRules: [],
        store,
      },
    );

    expect(newMessages.find((m) => m.role === "tool_result")?.content).toBe("1: SECRET=abc");
    expect(store.listPermissionRules(tmp)).toHaveLength(0);

    await rm(tmp, { recursive: true, force: true });
    await rm(storeBase, { recursive: true, force: true });
  });

  it("sensitive bash cat .env: approved but no bash rule saved", async () => {
    const tmp = await tmpDir();
    await writeFile(join(tmp, ".env"), "SECRET=x");

    const sessionRules: ApprovalRule[] = [];
    const registry = new ToolRegistry();
    registry.register(bashTool);

    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "bash",
          input: { command: "cat .env" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    await runTurn(provider, registry, makeSession(tmp), "cat env", {
      approval: "auto",
      approvalHandler: async () => "allow_for_session",
      sessionApprovalRules: sessionRules,
    });

    expect(sessionRules).toHaveLength(0);

    await rm(tmp, { recursive: true, force: true });
  });

  it("pre-existing external_directory rule does not auto-allow sensitive read_file", async () => {
    const ws = await tmpDir();
    const ext = await tmpDir();
    await writeFile(join(ext, "a.txt"), "aaa");
    await writeFile(join(ext, ".env"), "SECRET=x");

    const sessionRules: ApprovalRule[] = [
      {
        id: "pre-existing",
        workspaceRoot: ws,
        toolName: "external_directory",
        pattern: ext + "/*",
        action: "allow",
        scope: "session",
        createdAt: Date.now(),
      },
    ];

    const registry = new ToolRegistry();
    registry.register(readFileTool);

    let handlerCalled = 0;
    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "Read",
          input: { path: join(ext, ".env") },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    await runTurn(provider, registry, makeSession(ws), "read env", {
      approval: "auto",
      approvalHandler: async () => {
        handlerCalled++;
        return "allow_once";
      },
      sessionApprovalRules: sessionRules,
    });

    expect(handlerCalled).toBe(1);

    await rm(ws, { recursive: true, force: true });
    await rm(ext, { recursive: true, force: true });
  });

  it("pre-existing bash rg * rule does not auto-allow rg on sensitive file", async () => {
    const tmp = await tmpDir();
    await writeFile(join(tmp, ".env"), "SECRET=x");

    const sessionRules: ApprovalRule[] = [
      {
        id: "pre-existing-rg",
        workspaceRoot: tmp,
        toolName: "bash",
        pattern: "rg *",
        action: "allow",
        scope: "session",
        createdAt: Date.now(),
      },
    ];

    const registry = new ToolRegistry();
    registry.register(bashTool);

    let handlerCalled = 0;
    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "bash",
          input: { command: "rg SECRET .env" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    await runTurn(provider, registry, makeSession(tmp), "rg env", {
      approval: "auto",
      approvalHandler: async () => {
        handlerCalled++;
        return "allow_once";
      },
      sessionApprovalRules: sessionRules,
    });

    expect(handlerCalled).toBe(1);

    await rm(tmp, { recursive: true, force: true });
  });

  it("sensitive read_file .env: reject does not execute", async () => {
    const tmp = await tmpDir();
    await writeFile(join(tmp, ".env"), "SECRET=abc");

    const sessionRules: ApprovalRule[] = [];
    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "Read",
          input: { path: ".env" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "ok" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const { newMessages, aborted } = await runTurn(
      provider,
      registry,
      makeSession(tmp),
      "read env",
      {
        approval: "auto",
        approvalHandler: async () => "abort",
        sessionApprovalRules: sessionRules,
      },
    );

    expect(aborted).toBe(true);
    expect(newMessages.find((m) => m.role === "tool_result")?.content).toContain(
      "denied",
    );
    expect(sessionRules).toHaveLength(0);

    await rm(tmp, { recursive: true, force: true });
  });

  // --- write_file integration ---

  it("write_file creates checkpoint in session loop", async () => {
    const tmp = await tmpDir();
    await writeFile(join(tmp, "data.txt"), "original");

    const readState = new ReadStateTracker();
    const registry = new ToolRegistry();
    registry.register(readFileTool);
    registry.register(writeFileTool);

    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "Read",
          input: { path: "data.txt" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        {
          type: "tool_call",
          id: "tc2",
          name: "write_file",
          input: { path: "data.txt", content: "replaced" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const { newMessages } = await runTurn(
      provider,
      registry,
      makeSession(tmp),
      "read then write",
      {
        approval: "auto",
        approvalHandler: async () => "allow_once",
        readState,
      },
    );

    // Read succeeded
    const readResult = newMessages.find(
      (m) => m.role === "tool_result" && m.toolName === "Read",
    );
    expect(readResult?.content).toBe("1: original");

    // write_file succeeded with checkpoint
    const writeResult = newMessages.find(
      (m) => m.role === "tool_result" && m.toolName === "write_file",
    );
    expect(writeResult?.content).toContain("Wrote data.txt");
    expect(writeResult?.content).not.toContain("[checkpoint:");
    expect(writeResult?.checkpointId).toBeTruthy();

    // File was actually written
    const content = await readFile(join(tmp, "data.txt"), "utf-8");
    expect(content).toBe("replaced");

    await rm(tmp, { recursive: true, force: true });
  });

  it("write_file checkpoint restores new file", async () => {
    const tmp = await tmpDir();
    const readState = new ReadStateTracker();
    const registry = new ToolRegistry();
    registry.register(writeFileTool);

    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "write_file",
          input: { path: "newfile.txt", content: "new content" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const { newMessages } = await runTurn(
      provider,
      registry,
      makeSession(tmp),
      "create file",
      {
        approval: "auto",
        approvalHandler: async () => "allow_once",
        readState,
      },
    );

    const result = newMessages.find(
      (m) => m.role === "tool_result" && m.toolName === "write_file",
    );
    expect(result?.content).not.toContain("[checkpoint:");
    expect(result?.checkpointId).toBeTruthy();

    // Restore checkpoint
    const { restoreCheckpoint } = await import("../src/workspace/checkpoint.js");
    await restoreCheckpoint(tmp, result!.checkpointId!);

    // New file should be deleted
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(tmp, "newfile.txt"))).toBe(false);

    await rm(tmp, { recursive: true, force: true });
  });

  it("write_file checkpoint restores overwritten file", async () => {
    const tmp = await tmpDir();
    await writeFile(join(tmp, "data.txt"), "original");
    const readState = new ReadStateTracker();
    const registry = new ToolRegistry();
    registry.register(readFileTool);
    registry.register(writeFileTool);

    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "Read",
          input: { path: "data.txt" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        {
          type: "tool_call",
          id: "tc2",
          name: "write_file",
          input: { path: "data.txt", content: "overwritten" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const { newMessages } = await runTurn(
      provider,
      registry,
      makeSession(tmp),
      "read then overwrite",
      {
        approval: "auto",
        approvalHandler: async () => "allow_once",
        readState,
      },
    );

    const result = newMessages.find(
      (m) => m.role === "tool_result" && m.toolName === "write_file",
    );
    expect(result?.content).not.toContain("[checkpoint:");
    expect(result?.checkpointId).toBeTruthy();

    // Restore
    const { restoreCheckpoint } = await import("../src/workspace/checkpoint.js");
    await restoreCheckpoint(tmp, result!.checkpointId!);

    // Content should be original
    expect(await readFile(join(tmp, "data.txt"), "utf-8")).toBe("original");

    await rm(tmp, { recursive: true, force: true });
  });

  it("write_file is denied in never-approval mode", async () => {
    const tmp = await tmpDir();
    const registry = new ToolRegistry();
    registry.register(writeFileTool);

    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "write_file",
          input: { path: "new.txt", content: "data" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const { newMessages } = await runTurn(provider, registry, makeSession(tmp), "write", {
      approval: "never",
    });

    const result = newMessages.find((m) => m.role === "tool_result");
    expect(result?.content).toContain("denied");

    await rm(tmp, { recursive: true, force: true });
  });

  it("auto-approved write_file still creates checkpoint", async () => {
    const tmp = await tmpDir();
    await writeFile(join(tmp, "f.txt"), "v1");
    const sessionRules: ApprovalRule[] = [];
    const registry = new ToolRegistry();
    registry.register(readFileTool);
    registry.register(writeFileTool);

    // First read/write: approve write for session
    const provider1 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc0",
          name: "Read",
          input: { path: "f.txt" },
        },
        {
          type: "tool_call",
          id: "tc1",
          name: "write_file",
          input: { path: "f.txt", content: "v2" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    const r1 = await runTurn(provider1, registry, makeSession(tmp), "write", {
      approval: "auto",
      approvalHandler: async () => "allow_for_session",
      sessionApprovalRules: sessionRules,
    });
    const firstWrite = r1.newMessages.find(
      (m) => m.role === "tool_result" && m.toolName === "write_file",
    );
    expect(firstWrite?.content).not.toContain("[checkpoint:");
    expect(firstWrite?.checkpointId).toBeTruthy();
    // In auto mode, write_file is auto-allowed (no session rule needed)

    // Second read/write: write is auto-allowed, still checkpoint
    const provider2 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc-read2",
          name: "Read",
          input: { path: "f.txt" },
        },
        {
          type: "tool_call",
          id: "tc2",
          name: "write_file",
          input: { path: "f.txt", content: "v3" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    const r2 = await runTurn(provider2, registry, r1.session, "write again", {
      approval: "auto",
      sessionApprovalRules: sessionRules,
    });
    const secondWrite = r2.newMessages.find(
      (m) => m.role === "tool_result" && m.toolName === "write_file",
    );
    expect(secondWrite?.content).not.toContain("[checkpoint:");
    expect(secondWrite?.checkpointId).toBeTruthy();

    await rm(tmp, { recursive: true, force: true });
  });

  it("external_directory does not auto-allow write_file", async () => {
    const ws = await tmpDir();
    const ext = await tmpDir();
    await writeFile(join(ext, "a.txt"), "aaa");

    const sessionRules: ApprovalRule[] = [];
    const registry = new ToolRegistry();
    registry.register(readFileTool);
    registry.register(writeFileTool);

    let handlerCalled = 0;
    const handler = async () => {
      handlerCalled++;
      return "allow_for_session" as const;
    };

    // Approve reading from external dir
    const provider1 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "Read",
          input: { path: join(ext, "a.txt") },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    await runTurn(provider1, registry, makeSession(ws), "read", {
      approval: "auto",
      approvalHandler: handler,
      sessionApprovalRules: sessionRules,
    });
    expect(handlerCalled).toBe(1);

    // write_file to external dir should still ask (and be denied by policy)
    const provider2 = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc2",
          name: "write_file",
          input: { path: join(ext, "b.txt"), content: "new" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    const r2 = await runTurn(provider2, registry, makeSession(ws), "write external", {
      approval: "auto",
      sessionApprovalRules: sessionRules,
    });

    // write_file outside workspace is denied by policy
    const result = r2.newMessages.find(
      (m) => m.role === "tool_result" && m.toolName === "write_file",
    );
    expect(result?.content).toContain("denied");

    await rm(ws, { recursive: true, force: true });
    await rm(ext, { recursive: true, force: true });
  });

  it("same turn: read_file then write_file succeeds", async () => {
    const tmp = await tmpDir();
    await writeFile(join(tmp, "data.txt"), "original content");
    const readState = new ReadStateTracker();
    const registry = new ToolRegistry();
    registry.register(readFileTool);
    registry.register(writeFileTool);

    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "Read",
          input: { path: "data.txt" },
        },
        {
          type: "tool_call",
          id: "tc2",
          name: "write_file",
          input: { path: "data.txt", content: "updated content" },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const { newMessages } = await runTurn(
      provider,
      registry,
      makeSession(tmp),
      "read and write",
      {
        approval: "auto",
        approvalHandler: async () => "allow_once",
        readState,
      },
    );

    const results = newMessages.filter((m) => m.role === "tool_result");
    expect(results[0].content).toBe("1: original content");
    expect(results[1].content).toContain("Wrote data.txt");

    const content = await readFile(join(tmp, "data.txt"), "utf-8");
    expect(content).toBe("updated content");

    await rm(tmp, { recursive: true, force: true });
  });

  it("write_file failure does not expose checkpoint id", async () => {
    const tmp = await tmpDir();
    await writeFile(join(tmp, "data.txt"), "original");
    const registry = new ToolRegistry();
    registry.register(writeFileTool);

    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "write_file",
          input: { path: "data.txt", content: "updated" },
        },
        { type: "stop", reason: "tool_use" },
      ],
    ]);

    const { newMessages } = await runTurn(
      provider,
      registry,
      makeSession(tmp),
      "write without reading",
      {
        approval: "auto",
        approvalHandler: async () => "allow_once",
        readState: new ReadStateTracker(),
      },
    );

    const result = newMessages.find(
      (m) => m.role === "tool_result" && m.toolName === "write_file",
    );
    expect(result?.content).toContain("must be read with read_file");
    expect(result?.content).not.toContain("[checkpoint:");
    expect(result?.checkpointId).toBeUndefined();

    await rm(tmp, { recursive: true, force: true });
  });

  it("write_file approval event includes diff metadata", async () => {
    const tmp = await tmpDir();
    await writeFile(join(tmp, "data.txt"), "old\n");
    const registry = new ToolRegistry();
    registry.register(writeFileTool);
    const events: TurnEvent[] = [];

    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "write_file",
          input: { path: "data.txt", content: "new\n" },
        },
        { type: "stop", reason: "tool_use" },
      ],
    ]);

    await runTurn(provider, registry, makeSession(tmp), "write", {
      approval: "on-request",
      approvalHandler: async () => "abort",
      onEvent: (event) => {
        events.push(event);
      },
    });

    const approvalEvent = events.find(
      (e): e is Extract<TurnEvent, { type: "tool_approval_required" }> =>
        e.type === "tool_approval_required",
    );
    expect(approvalEvent?.metadata?.diff).toContain("-old");
    expect(approvalEvent?.metadata?.diff).toContain("+new");
    expect(approvalEvent?.metadata?.additions).toBe(1);
    expect(approvalEvent?.metadata?.deletions).toBe(1);

    await rm(tmp, { recursive: true, force: true });
  });

  // --- apply_patch integration ---

  it("apply_patch creates checkpoint covering all affected paths", async () => {
    const tmp = await tmpDir();
    await writeFile(join(tmp, "a.txt"), "old-a");
    await writeFile(join(tmp, "b.txt"), "old-b");
    const registry = new ToolRegistry();
    registry.register(applyPatchTool);

    const patch = `*** Begin Patch
*** Add File: c.txt
+new-c
*** Update File: a.txt
@@
-old-a
+new-a
*** Delete File: b.txt
*** End Patch`;

    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "apply_patch",
          input: { patch },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const { newMessages } = await runTurn(provider, registry, makeSession(tmp), "patch", {
      approval: "auto",
      approvalHandler: async () => "allow_once",
    });

    const result = newMessages.find(
      (m) => m.role === "tool_result" && m.toolName === "apply_patch",
    );
    expect(result?.content).toContain("Applied patch");
    expect(result?.content).not.toContain("[checkpoint:");
    expect(result?.checkpointId).toBeTruthy();

    // Verify changes applied
    expect(await readFile(join(tmp, "a.txt"), "utf-8")).toBe("new-a");
    expect(existsSync(join(tmp, "b.txt"))).toBe(false);
    expect(await readFile(join(tmp, "c.txt"), "utf-8")).toBe("new-c");

    // Restore checkpoint
    const { restoreCheckpoint } = await import("../src/workspace/checkpoint.js");
    await restoreCheckpoint(tmp, result!.checkpointId!);

    // Verify restoration
    expect(await readFile(join(tmp, "a.txt"), "utf-8")).toBe("old-a");
    expect(await readFile(join(tmp, "b.txt"), "utf-8")).toBe("old-b");
    expect(existsSync(join(tmp, "c.txt"))).toBe(false);

    await rm(tmp, { recursive: true, force: true });
  });

  it("apply_patch is denied in never-approval mode", async () => {
    const tmp = await tmpDir();
    const registry = new ToolRegistry();
    registry.register(applyPatchTool);

    const patch = `*** Begin Patch
*** Add File: x.txt
+content
*** End Patch`;

    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "apply_patch",
          input: { patch },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const { newMessages } = await runTurn(provider, registry, makeSession(tmp), "patch", {
      approval: "never",
    });

    const result = newMessages.find(
      (m) => m.role === "tool_result" && m.toolName === "apply_patch",
    );
    expect(result?.content).toContain("denied");
    expect(existsSync(join(tmp, "x.txt"))).toBe(false);

    await rm(tmp, { recursive: true, force: true });
  });

  it("apply_patch approval event includes diff and affected paths", async () => {
    const tmp = await tmpDir();
    await writeFile(join(tmp, "app.ts"), "old\n");
    const registry = new ToolRegistry();
    registry.register(applyPatchTool);
    const events: TurnEvent[] = [];

    const patch = `*** Begin Patch
*** Add File: new.txt
+new file
*** Update File: app.ts
@@
-old
+new
*** End Patch`;

    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "apply_patch",
          input: { patch },
        },
        { type: "stop", reason: "tool_use" },
      ],
    ]);

    await runTurn(provider, registry, makeSession(tmp), "patch", {
      approval: "on-request",
      approvalHandler: async () => "abort",
      onEvent: (event) => {
        events.push(event);
      },
    });

    const approvalEvent = events.find(
      (e): e is Extract<TurnEvent, { type: "tool_approval_required" }> =>
        e.type === "tool_approval_required",
    );
    expect(approvalEvent).toBeDefined();
    expect(approvalEvent?.metadata?.operation).toBe("patch");
    expect(approvalEvent?.metadata?.affectedPaths).toEqual(["app.ts", "new.txt"]);
    expect(approvalEvent?.metadata?.diff).toContain("+new file");
    expect(approvalEvent?.metadata?.diff).toContain("-old");
    expect(approvalEvent?.metadata?.diff).toContain("+new");
    expect(typeof approvalEvent?.metadata?.additions).toBe("number");
    expect(typeof approvalEvent?.metadata?.deletions).toBe("number");

    await rm(tmp, { recursive: true, force: true });
  });

  it("apply_patch sensitive paths are not auto-approved by existing session rule", async () => {
    const tmp = await tmpDir();
    await writeFile(join(tmp, ".env"), "TOKEN=old\n");
    const registry = new ToolRegistry();
    registry.register(applyPatchTool);
    const sessionRules: ApprovalRule[] = [
      {
        id: randomUUID(),
        workspaceRoot: tmp,
        toolName: "apply_patch",
        pattern: ".env",
        action: "allow",
        scope: "session",
        reason: "previous patch approval",
        createdAt: Date.now(),
      },
    ];
    const events: TurnEvent[] = [];

    const patch = `*** Begin Patch
*** Update File: .env
@@
-TOKEN=old
+TOKEN=new
*** End Patch`;

    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "apply_patch",
          input: { patch },
        },
        { type: "stop", reason: "tool_use" },
      ],
    ]);

    const { newMessages } = await runTurn(provider, registry, makeSession(tmp), "patch", {
      approval: "auto",
      sessionApprovalRules: sessionRules,
      approvalHandler: async () => "abort",
      onEvent: (event) => {
        events.push(event);
      },
    });

    const approvalEvent = events.find(
      (e): e is Extract<TurnEvent, { type: "tool_approval_required" }> =>
        e.type === "tool_approval_required",
    );
    expect(approvalEvent).toBeDefined();
    expect(approvalEvent?.metadata?.sensitive).toBe(true);
    expect(approvalEvent?.metadata?.diff).toBeUndefined();
    expect(JSON.stringify(approvalEvent?.metadata)).not.toContain("TOKEN=old");
    expect(newMessages.some((m) => m.role === "tool_result")).toBe(true);
    expect(await readFile(join(tmp, ".env"), "utf-8")).toBe("TOKEN=old\n");

    await rm(tmp, { recursive: true, force: true });
  });

  it("apply_patch without approvalHandler reports requires approval", async () => {
    const tmp = await tmpDir();
    const registry = new ToolRegistry();
    registry.register(applyPatchTool);

    const patch = `*** Begin Patch
*** Add File: x.txt
+content
*** End Patch`;

    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "apply_patch",
          input: { patch },
        },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const { newMessages } = await runTurn(provider, registry, makeSession(tmp), "patch", {
      approval: "on-request",
    });

    const result = newMessages.find(
      (m) => m.role === "tool_result" && m.toolName === "apply_patch",
    );
    expect(result?.content).toContain("requires approval");
    expect(existsSync(join(tmp, "x.txt"))).toBe(false);

    await rm(tmp, { recursive: true, force: true });
  });
});

// --- Truncation (stop reason = length) ---

describe("Truncation handling", () => {
  function makeSession(cwd: string, messages: Message[] = []): SessionState {
    return { id: randomUUID(), cwd, messages };
  }

  it("marks stopReason as length when provider returns length stop", async () => {
    const provider = new FakeProvider([
      [
        { type: "text_delta", text: "I was cut off mid-" },
        { type: "stop", reason: "length" },
      ],
    ]);

    const { stopReason, aborted } = await runTurn(
      provider,
      new ToolRegistry(),
      makeSession(process.cwd()),
      "do something",
      { approval: "auto" },
    );

    expect(stopReason).toBe("length");
    expect(aborted).toBeFalsy();
  });

  it("emits turn_truncated event when stop reason is length", async () => {
    const provider = new FakeProvider([
      [
        { type: "text_delta", text: "partial" },
        { type: "stop", reason: "length" },
      ],
    ]);

    const events: TurnEvent[] = [];
    await runTurn(provider, new ToolRegistry(), makeSession(process.cwd()), "hi", {
      approval: "auto",
      onEvent: (e) => { events.push(e); },
    });

    const types = events.map((e) => e.type);
    expect(types).toContain("turn_truncated");
    expect(types).toContain("turn_finished");
    expect(types.indexOf("turn_truncated")).toBeLessThan(types.indexOf("turn_finished"));
  });

  it("does not emit turn_truncated on normal end_turn", async () => {
    const provider = new FakeProvider([
      [
        { type: "text_delta", text: "complete" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const events: TurnEvent[] = [];
    const { stopReason } = await runTurn(
      provider,
      new ToolRegistry(),
      makeSession(process.cwd()),
      "hi",
      { approval: "auto", onEvent: (e) => { events.push(e); } },
    );

    expect(stopReason).toBe("end_turn");
    const types = events.map((e) => e.type);
    expect(types).not.toContain("turn_truncated");
  });

  it("does not emit turn_truncated on tool_use", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-test-"));
    await writeFile(join(tmp, "f.txt"), "hi");

    const provider = new FakeProvider([
      [
        { type: "tool_call", id: "tc1", name: "Read", input: { path: "f.txt" } },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const events: TurnEvent[] = [];
    const { stopReason } = await runTurn(provider, registry, makeSession(tmp), "read", {
      approval: "auto",
      onEvent: (e) => { events.push(e); },
    });

    expect(stopReason).toBe("end_turn");
    const types = events.map((e) => e.type);
    expect(types).not.toContain("turn_truncated");

    await rm(tmp, { recursive: true, force: true });
  });

  it("truncation is not the same as aborted", async () => {
    const provider = new FakeProvider([
      [
        { type: "text_delta", text: "cut short" },
        { type: "stop", reason: "length" },
      ],
    ]);

    const { aborted, stopReason } = await runTurn(
      provider,
      new ToolRegistry(),
      makeSession(process.cwd()),
      "hi",
      { approval: "auto" },
    );

    expect(aborted).toBeFalsy();
    expect(stopReason).toBe("length");
  });

  it("runSession propagates stopReason", async () => {
    const provider = new FakeProvider([
      [
        { type: "text_delta", text: "truncated output" },
        { type: "stop", reason: "length" },
      ],
    ]);

    const { stopReason, aborted } = await runSession(
      provider,
      new ToolRegistry(),
      [{ role: "user", content: "go" }],
      { cwd: process.cwd(), approval: "auto" },
    );

    expect(stopReason).toBe("length");
    expect(aborted).toBeFalsy();
  });
});

// --- Patch validation vs permission deny ---

describe("Patch validation vs permission deny", () => {
  function makeSession(cwd: string, messages: Message[] = []): SessionState {
    return { id: randomUUID(), cwd, messages };
  }

  it("invalid patch shows validation failure, not denied", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "app.ts"), "line1\nactual\nline3");

    const patch = `*** Begin Patch
*** Update File: app.ts
@@
 line1
-wrong
+new
 line3
*** End Patch`;

    const provider = new FakeProvider([
      [
        { type: "tool_call", id: "tc1", name: "apply_patch", input: { patch } },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "ok" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(applyPatchTool);

    const { newMessages, aborted } = await runTurn(
      provider,
      registry,
      makeSession(tmp),
      "patch",
      { approval: "auto" },
    );

    expect(aborted).toBeFalsy();
    const result = newMessages.find((m) => m.role === "tool_result");
    expect(result).toBeDefined();
    expect(result!.content).toContain("validation failed");
    expect(result!.content).not.toContain("denied");

    await rm(tmp, { recursive: true, force: true });
  });

  it("never-approval mode still shows denied", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));

    const patch = `*** Begin Patch
*** Add File: new.txt
+content
*** End Patch`;

    const provider = new FakeProvider([
      [
        { type: "tool_call", id: "tc1", name: "apply_patch", input: { patch } },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "ok" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(applyPatchTool);

    const { newMessages, aborted } = await runTurn(
      provider,
      registry,
      makeSession(tmp),
      "patch",
      { approval: "never" },
    );

    expect(aborted).toBeFalsy();
    const result = newMessages.find((m) => m.role === "tool_result");
    expect(result).toBeDefined();
    expect(result!.content).toContain("denied");
    expect(result!.content).not.toContain("validation failed");

    await rm(tmp, { recursive: true, force: true });
  });

  it("invalid patch does not trigger approval handler", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "app.ts"), "line1\nactual\nline3");

    const patch = `*** Begin Patch
*** Update File: app.ts
@@
 line1
-wrong
+new
 line3
*** End Patch`;

    const provider = new FakeProvider([
      [
        { type: "tool_call", id: "tc1", name: "apply_patch", input: { patch } },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "ok" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(applyPatchTool);

    let handlerCalled = false;
    const events: TurnEvent[] = [];
    const { newMessages } = await runTurn(
      provider,
      registry,
      makeSession(tmp),
      "patch",
      {
        approval: "auto",
        approvalHandler: async () => {
          handlerCalled = true;
          return "allow_once";
        },
        onEvent: (e) => { events.push(e); },
      },
    );

    expect(handlerCalled).toBe(false);
    expect(events.some((e) => e.type === "tool_approval_required")).toBe(false);
    const result = newMessages.find((m) => m.role === "tool_result");
    expect(result!.content).toContain("validation failed");

    await rm(tmp, { recursive: true, force: true });
  });
});
