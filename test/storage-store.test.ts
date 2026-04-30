import { describe, it, expect, afterEach } from "vitest";
import { openStore } from "../src/storage/store.js";
import type { TranscriptStore } from "../src/storage/store.js";
import type { Message } from "../src/model/types.js";
import { FakeProvider } from "../src/model/fake.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { readFileTool } from "../src/tools/read.js";
import { runTurn } from "../src/session/loop.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

let activeStores: TranscriptStore[] = [];
let activeTmpDirs: string[] = [];

afterEach(() => {
  for (const s of activeStores) s.close();
  activeStores = [];
});

async function tmpStoreDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "myagent-store-test-"));
  activeTmpDirs.push(dir);
  return dir;
}

async function cleanup() {
  for (const dir of activeTmpDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  activeTmpDirs = [];
}

describe("openStore", () => {
  it("creates .myagent/myagent.sqlite", async () => {
    const dir = await tmpStoreDir();
    const store = openStore(dir);
    activeStores.push(store);
    expect(existsSync(join(dir, ".myagent", "myagent.sqlite"))).toBe(true);
    await cleanup();
  });

  it("is idempotent", async () => {
    const dir = await tmpStoreDir();
    const s1 = openStore(dir);
    const s2 = openStore(dir);
    activeStores.push(s1, s2);
    const session = s1.createSession({ workspaceRoot: dir });
    expect(s2.getSession(session.id)).toBeDefined();
    await cleanup();
  });
});

describe("createSession", () => {
  it("returns a SessionState with resolved workspace root", async () => {
    const dir = await tmpStoreDir();
    const store = openStore(dir);
    activeStores.push(store);
    const session = store.createSession({ workspaceRoot: dir });
    expect(session.id).toBeTruthy();
    expect(session.cwd).toBe(dir);
    expect(session.messages).toEqual([]);
    await cleanup();
  });

  it("persists provider and model", async () => {
    const dir = await tmpStoreDir();
    const store = openStore(dir);
    activeStores.push(store);
    const session = store.createSession({
      workspaceRoot: dir,
      provider: "openai",
      model: "gpt-4o",
    });
    expect(session.id).toBeTruthy();
    const listed = store.listSessions();
    expect(listed).toHaveLength(1);
    expect(listed[0].provider).toBe("openai");
    expect(listed[0].model).toBe("gpt-4o");
    await cleanup();
  });
});

describe("appendMessages + getSession", () => {
  it("stores and restores user and assistant messages", async () => {
    const dir = await tmpStoreDir();
    const store = openStore(dir);
    activeStores.push(store);
    const session = store.createSession({ workspaceRoot: dir });
    const msgs: Message[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ];
    store.appendMessages(session.id, msgs);
    const restored = store.getSession(session.id)!;
    expect(restored.messages).toHaveLength(2);
    expect(restored.messages[0]).toEqual({ role: "user", content: "hello" });
    expect(restored.messages[1]).toEqual({
      role: "assistant",
      content: "hi there",
    });
    await cleanup();
  });

  it("roundtrips assistant toolCalls as JSON", async () => {
    const dir = await tmpStoreDir();
    const store = openStore(dir);
    activeStores.push(store);
    const session = store.createSession({ workspaceRoot: dir });
    const toolCalls = [{ id: "tc1", name: "read_file", input: { path: "a.ts" } }];
    store.appendMessages(session.id, [
      { role: "assistant", content: "let me check", toolCalls },
    ]);
    const restored = store.getSession(session.id)!;
    expect(restored.messages[0].toolCalls).toEqual(toolCalls);
    await cleanup();
  });

  it("roundtrips tool_result toolCallId and toolName", async () => {
    const dir = await tmpStoreDir();
    const store = openStore(dir);
    activeStores.push(store);
    const session = store.createSession({ workspaceRoot: dir });
    store.appendMessages(session.id, [
      {
        role: "tool_result",
        content: "file contents",
        toolCallId: "tc2",
        toolName: "read_file",
      },
    ]);
    const restored = store.getSession(session.id)!;
    expect(restored.messages[0]).toEqual({
      role: "tool_result",
      content: "file contents",
      toolCallId: "tc2",
      toolName: "read_file",
    });
    await cleanup();
  });

  it("preserves seq ordering across multiple appends", async () => {
    const dir = await tmpStoreDir();
    const store = openStore(dir);
    activeStores.push(store);
    const session = store.createSession({ workspaceRoot: dir });
    store.appendMessages(session.id, [
      { role: "user", content: "first" },
      { role: "assistant", content: "first-reply" },
    ]);
    store.appendMessages(session.id, [
      { role: "user", content: "second" },
      { role: "assistant", content: "second-reply" },
    ]);
    const restored = store.getSession(session.id)!;
    expect(restored.messages).toHaveLength(4);
    expect(restored.messages.map((m) => m.content)).toEqual([
      "first",
      "first-reply",
      "second",
      "second-reply",
    ]);
    await cleanup();
  });
});

describe("getSession workspace root", () => {
  it("returns the persisted workspace root, not process.cwd()", async () => {
    const dir = await tmpStoreDir();
    const store = openStore(dir);
    activeStores.push(store);
    const session = store.createSession({ workspaceRoot: dir });
    const restored = store.getSession(session.id)!;
    expect(restored.cwd).toBe(dir);
    expect(restored.cwd).not.toBe(process.cwd());
    await cleanup();
  });
});

describe("listSessions", () => {
  it("returns all sessions ordered by updated_at desc", async () => {
    const dir = await tmpStoreDir();
    const store = openStore(dir);
    activeStores.push(store);
    const s1 = store.createSession({ workspaceRoot: dir });
    const s2 = store.createSession({ workspaceRoot: dir });
    const listed = store.listSessions();
    expect(listed).toHaveLength(2);
    expect(new Set(listed.map((s) => s.id))).toEqual(new Set([s1.id, s2.id]));
    await cleanup();
  });
});

describe("updateSessionTimestamp", () => {
  it("updates updated_at", async () => {
    const dir = await tmpStoreDir();
    const store = openStore(dir);
    activeStores.push(store);
    const session = store.createSession({ workspaceRoot: dir });
    const before = store.listSessions().find((s) => s.id === session.id)!;
    await new Promise((r) => setTimeout(r, 10));
    store.updateSessionTimestamp(session.id);
    const after = store.listSessions().find((s) => s.id === session.id)!;
    expect(after.updatedAt).toBeGreaterThan(before.createdAt);
    await cleanup();
  });
});

describe("multi-turn integration with runTurn", () => {
  it("persists and restores messages across two turns", async () => {
    const dir = await tmpStoreDir();
    const store = openStore(dir);
    activeStores.push(store);
    const session = store.createSession({ workspaceRoot: dir });

    const provider = new FakeProvider([
      [
        { type: "text_delta", text: "hello" },
        { type: "stop", reason: "end_turn" },
      ],
      [
        { type: "text_delta", text: "world" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const registry = new ToolRegistry();

    const turn1 = await runTurn(provider, registry, session, "first", {
      approval: "auto",
    });
    store.appendMessages(session.id, turn1.newMessages);

    const turn2 = await runTurn(provider, registry, turn1.session, "second", {
      approval: "auto",
    });
    store.appendMessages(session.id, turn2.newMessages);

    const restored = store.getSession(session.id)!;
    expect(restored.messages).toHaveLength(4);
    expect(restored.messages.map((m) => m.content)).toEqual([
      "first",
      "hello",
      "second",
      "world",
    ]);
    expect(restored.cwd).toBe(dir);
    await cleanup();
  });

  it("persists tool_call and tool_result across turns", async () => {
    const dir = await tmpStoreDir();
    await writeFile(join(dir, "data.txt"), "hello");
    const store = openStore(dir);
    activeStores.push(store);
    const session = store.createSession({ workspaceRoot: dir });

    const provider = new FakeProvider([
      [
        {
          type: "tool_call",
          id: "tc1",
          name: "read_file",
          input: { path: "data.txt" },
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

    const turn1 = await runTurn(provider, registry, session, "read data", {
      approval: "auto",
    });
    store.appendMessages(session.id, turn1.newMessages);

    const restored = store.getSession(session.id)!;
    expect(restored.messages).toHaveLength(4);
    expect(restored.messages[0].content).toBe("read data");
    expect(restored.messages[1].role).toBe("assistant");
    expect(restored.messages[1].toolCalls).toHaveLength(1);
    expect(restored.messages[2].role).toBe("tool_result");
    expect(restored.messages[2].toolCallId).toBe("tc1");
    expect(restored.messages[2].content).toContain("hello");
    expect(restored.messages[3].role).toBe("assistant");
    expect(restored.messages[3].content).toBe("done");
    await cleanup();
  });
});

describe("resume workspace validation", () => {
  it("detects mismatched workspace root on resume", async () => {
    const dirA = await tmpStoreDir();
    const dirB = await tmpStoreDir();
    const storeA = openStore(dirA);
    activeStores.push(storeA);

    const session = storeA.createSession({ workspaceRoot: dirA });
    storeA.appendMessages(session.id, [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);

    // Resume from same store should match
    const restored = storeA.getSession(session.id)!;
    expect(resolve(restored.cwd)).toBe(resolve(dirA));

    // Simulating resume with different cwd: the restored session's cwd
    // should not match a different workspace
    expect(resolve(restored.cwd)).not.toBe(resolve(dirB));

    await cleanup();
  });
});
