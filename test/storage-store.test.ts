import { describe, it, expect, afterEach } from "vitest";
import { openStore } from "../src/storage/store.js";
import type { TranscriptStore } from "../src/storage/store.js";
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

async function tmpBaseDir(): Promise<string> {
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

function openTestStore(baseDir: string): TranscriptStore {
  const store = openStore({ baseDir });
  activeStores.push(store);
  return store;
}

describe("openStore", () => {
  it("creates myagent.sqlite in baseDir", async () => {
    const base = await tmpBaseDir();
    openTestStore(base);
    expect(existsSync(join(base, "myagent.sqlite"))).toBe(true);
    await cleanup();
  });

  it("is idempotent", async () => {
    const base = await tmpBaseDir();
    const s1 = openTestStore(base);
    const s2 = openTestStore(base);
    const session = s1.createSession({ workspaceRoot: "/tmp/ws" });
    expect(s2.getSession(session.id)).toBeDefined();
    await cleanup();
  });
});

describe("createSession", () => {
  it("returns a SessionState with the given workspace root", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const session = store.createSession({ workspaceRoot: "/tmp/project" });
    expect(session.id).toBeTruthy();
    expect(session.cwd).toBe("/tmp/project");
    expect(session.messages).toEqual([]);
    await cleanup();
  });

  it("persists provider and model", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    store.createSession({
      workspaceRoot: "/tmp/ws",
      provider: "openai",
      model: "gpt-4o",
    });
    const listed = store.listSessions();
    expect(listed).toHaveLength(1);
    expect(listed[0].provider).toBe("openai");
    expect(listed[0].model).toBe("gpt-4o");
    await cleanup();
  });
});

describe("appendMessages + getSession", () => {
  it("stores and restores user and assistant messages", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const session = store.createSession({ workspaceRoot: "/tmp/ws" });
    store.appendMessages(session.id, [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ]);
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
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const session = store.createSession({ workspaceRoot: "/tmp/ws" });
    const toolCalls = [{ id: "tc1", name: "read_file", input: { path: "a.ts" } }];
    store.appendMessages(session.id, [
      { role: "assistant", content: "let me check", toolCalls },
    ]);
    const restored = store.getSession(session.id)!;
    expect(restored.messages[0].toolCalls).toEqual(toolCalls);
    await cleanup();
  });

  it("roundtrips tool_result toolCallId and toolName", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const session = store.createSession({ workspaceRoot: "/tmp/ws" });
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
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const session = store.createSession({ workspaceRoot: "/tmp/ws" });
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

describe("title from first user message", () => {
  it("sets title from first user message content", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const session = store.createSession({ workspaceRoot: "/tmp/ws" });
    store.appendMessages(session.id, [
      { role: "user", content: "fix the bug in auth.ts please" },
    ]);
    const listed = store.listSessions();
    expect(listed[0].title).toBe("fix the bug in auth.ts please");
    await cleanup();
  });

  it("truncates title to 60 characters", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const session = store.createSession({ workspaceRoot: "/tmp/ws" });
    const longContent = "a".repeat(100);
    store.appendMessages(session.id, [{ role: "user", content: longContent }]);
    const listed = store.listSessions();
    expect(listed[0].title).toBe("a".repeat(60));
    await cleanup();
  });

  it("does not overwrite title on subsequent appends", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const session = store.createSession({ workspaceRoot: "/tmp/ws" });
    store.appendMessages(session.id, [{ role: "user", content: "first prompt" }]);
    store.appendMessages(session.id, [{ role: "user", content: "second prompt" }]);
    const listed = store.listSessions();
    expect(listed[0].title).toBe("first prompt");
    await cleanup();
  });
});

describe("getSession workspace root", () => {
  it("returns the persisted workspace root, not process.cwd()", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const ws = await tmpBaseDir();
    const session = store.createSession({ workspaceRoot: ws });
    const restored = store.getSession(session.id)!;
    expect(restored.cwd).toBe(ws);
    expect(restored.cwd).not.toBe(process.cwd());
    await cleanup();
  });
});

describe("listSessions", () => {
  it("returns sessions ordered by updated_at desc", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const s1 = store.createSession({ workspaceRoot: "/tmp/a" });
    await new Promise((r) => setTimeout(r, 10));
    const s2 = store.createSession({ workspaceRoot: "/tmp/b" });
    const listed = store.listSessions();
    expect(listed).toHaveLength(2);
    expect(listed[0].id).toBe(s2.id);
    expect(listed[1].id).toBe(s1.id);
    await cleanup();
  });

  it("returns empty array when no sessions", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    expect(store.listSessions()).toEqual([]);
    await cleanup();
  });
});

describe("updateSessionTimestamp", () => {
  it("updates updated_at", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const session = store.createSession({ workspaceRoot: "/tmp/ws" });
    const before = store.listSessions().find((s) => s.id === session.id)!;
    await new Promise((r) => setTimeout(r, 10));
    store.updateSessionTimestamp(session.id);
    const after = store.listSessions().find((s) => s.id === session.id)!;
    expect(after.updatedAt).toBeGreaterThan(before.createdAt);
    await cleanup();
  });
});

describe("resume finds workspace from global store", () => {
  it("resume without --cwd finds workspace via global store", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const ws = "/tmp/some-workspace";

    const session = store.createSession({
      workspaceRoot: ws,
      provider: "openai",
      model: "gpt-4o",
    });
    store.appendMessages(session.id, [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);

    // Simulate resume: look up by session id
    const restored = store.getSession(session.id)!;
    expect(restored).toBeDefined();
    expect(restored.cwd).toBe(ws);
    expect(restored.messages).toHaveLength(2);
    await cleanup();
  });

  it("detects mismatched workspace root on resume", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);

    const session = store.createSession({
      workspaceRoot: "/tmp/workspace-a",
    });
    store.appendMessages(session.id, [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);

    const restored = store.getSession(session.id)!;
    // Session was created in workspace-a
    expect(resolve(restored.cwd)).toBe(resolve("/tmp/workspace-a"));
    // A different cwd should not match
    expect(resolve(restored.cwd)).not.toBe(resolve("/tmp/workspace-b"));
    await cleanup();
  });
});

describe("multi-turn integration with runTurn", () => {
  it("persists and restores messages across two turns", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const ws = await tmpBaseDir();
    const session = store.createSession({ workspaceRoot: ws });

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
    expect(restored.cwd).toBe(ws);
    await cleanup();
  });

  it("persists tool_call and tool_result across turns", async () => {
    const base = await tmpBaseDir();
    const ws = await tmpBaseDir();
    const store = openTestStore(base);
    await writeFile(join(ws, "data.txt"), "hello");
    const session = store.createSession({ workspaceRoot: ws });

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

describe("permission_rules", () => {
  it("addPermissionRule inserts and listPermissionRules returns rules", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    store.addPermissionRule({
      workspaceRoot: "/tmp/ws",
      toolName: "bash",
      pattern: "npm test",
    });
    const rules = store.listPermissionRules("/tmp/ws");
    expect(rules).toHaveLength(1);
    expect(rules[0].toolName).toBe("bash");
    expect(rules[0].pattern).toBe("npm test");
    expect(rules[0].id).toBeTruthy();
    expect(rules[0].createdAt).toBeGreaterThan(0);
    await cleanup();
  });

  it("findMatchingRule finds a matching rule", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    store.addPermissionRule({
      workspaceRoot: "/tmp/ws",
      toolName: "bash",
      pattern: "npm test",
    });
    const match = store.findMatchingRule("/tmp/ws", "bash", "npm test");
    expect(match).toBeDefined();
    expect(match!.toolName).toBe("bash");
    expect(match!.pattern).toBe("npm test");
    await cleanup();
  });

  it("addPermissionRule reuses an existing matching rule", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const first = store.addPermissionRule({
      workspaceRoot: "/tmp/ws",
      toolName: "bash",
      pattern: "npm test",
    });
    const second = store.addPermissionRule({
      workspaceRoot: "/tmp/ws",
      toolName: "bash",
      pattern: "npm test",
    });

    expect(second).toBe(first);
    expect(store.listPermissionRules("/tmp/ws")).toHaveLength(1);
    await cleanup();
  });

  it("findMatchingRule returns undefined for different workspace", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    store.addPermissionRule({
      workspaceRoot: "/tmp/ws-a",
      toolName: "bash",
      pattern: "npm test",
    });
    const match = store.findMatchingRule("/tmp/ws-b", "bash", "npm test");
    expect(match).toBeUndefined();
    await cleanup();
  });

  it("findMatchingRule returns undefined for different toolName", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    store.addPermissionRule({
      workspaceRoot: "/tmp/ws",
      toolName: "bash",
      pattern: "npm test",
    });
    const match = store.findMatchingRule("/tmp/ws", "read_file", "npm test");
    expect(match).toBeUndefined();
    await cleanup();
  });

  it("findMatchingRule returns undefined for different pattern", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    store.addPermissionRule({
      workspaceRoot: "/tmp/ws",
      toolName: "bash",
      pattern: "npm test",
    });
    const match = store.findMatchingRule("/tmp/ws", "bash", "npm run test");
    expect(match).toBeUndefined();
    await cleanup();
  });

  it("listPermissionRules only returns rules for the given workspace", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    store.addPermissionRule({
      workspaceRoot: "/tmp/ws-a",
      toolName: "bash",
      pattern: "ls",
    });
    store.addPermissionRule({
      workspaceRoot: "/tmp/ws-b",
      toolName: "bash",
      pattern: "ls",
    });
    store.addPermissionRule({
      workspaceRoot: "/tmp/ws-a",
      toolName: "bash",
      pattern: "pwd",
    });
    const rules = store.listPermissionRules("/tmp/ws-a");
    expect(rules).toHaveLength(2);
    expect(rules.every((r) => r.id)).toBe(true);
    await cleanup();
  });
});
