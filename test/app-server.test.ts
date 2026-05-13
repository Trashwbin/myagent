import { describe, expect, it, afterEach } from "vitest";
import { parseClientMessage } from "../src/app/protocol.js";
import { createAppServer, findAvailablePort } from "../src/app/server.js";
import { SessionManager } from "../src/app/session-api.js";
import { ProviderRuntimeError } from "../src/model/errors.js";
import type { Provider } from "../src/model/provider.js";
import type { TranscriptStore } from "../src/storage/store.js";
import { openStore } from "../src/storage/store.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocket } from "ws";
import { createCheckpoint } from "../src/workspace/checkpoint.js";

let activeServers: import("node:http").Server[] = [];
let activeStores: TranscriptStore[] = [];
let activeTmpDirs: string[] = [];
let activeWs: WebSocket[] = [];

afterEach(async () => {
  for (const ws of activeWs) ws.close();
  activeWs = [];
  for (const s of activeServers) s.close();
  activeServers = [];
  for (const s of activeStores) s.close();
  activeStores = [];
  for (const d of activeTmpDirs) await rm(d, { recursive: true, force: true }).catch(() => {});
  activeTmpDirs = [];
});

async function tmpBaseDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "myagent-app-test-"));
  activeTmpDirs.push(dir);
  return dir;
}

function openTestStore(baseDir: string): TranscriptStore {
  const store = openStore({ baseDir });
  activeStores.push(store);
  return store;
}

function noopProvider(): Provider {
  return {
    name: "test",
    async *stream() {
      yield { type: "text" as const, delta: "ok" };
      yield { type: "finish" as const, reason: "stop" as const };
    },
  };
}

function delayedProvider(blocker: Promise<void>): Provider {
  return {
    name: "test",
    async *stream() {
      await blocker;
      yield { type: "text" as const, delta: "ok" };
      yield { type: "finish" as const, reason: "stop" as const };
    },
  };
}

function summaryProvider(summary: string): Provider {
  return {
    name: "test",
    async *stream() {
      yield { type: "text" as const, delta: summary };
      yield { type: "finish" as const, reason: "stop" as const };
    },
  };
}

function throwingProvider(error: unknown): Provider {
  return {
    name: "test",
    async *stream() {
      throw error;
    },
  };
}

async function waitForCondition(check: () => boolean, message: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

async function startTestServer(store: TranscriptStore) {
  const port = await findAvailablePort(43200);
  const server = createAppServer({
    provider: noopProvider(),
    providerName: "openai",
    modelName: "test-model",
    registry: new ToolRegistry(),
    approval: "on-request",
    store,
    cwd: "/test",
  });
  activeServers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve());
  });
  return { server, port };
}

function fetchJson(port: number, path: string, init?: RequestInit) {
  return fetch(`http://127.0.0.1:${port}${path}`, init).then((r) => r.json());
}

// --- Tests ---

describe("parseClientMessage", () => {
  it("parses valid subscribe_session", () => {
    const msg = parseClientMessage({ type: "subscribe_session", sessionId: "abc" });
    expect(msg).toEqual({ type: "subscribe_session", sessionId: "abc" });
  });

  it("parses valid user_message", () => {
    const msg = parseClientMessage({ type: "user_message", sessionId: "s1", text: "hello" });
    expect(msg).toEqual({ type: "user_message", sessionId: "s1", text: "hello" });
  });

  it("parses valid approval_decision", () => {
    const msg = parseClientMessage({ type: "approval_decision", approvalId: "a1", decision: "allow_once" });
    expect(msg).toEqual({ type: "approval_decision", approvalId: "a1", decision: "allow_once" });
  });

  it("parses rewind_session, revert_last, and compact_session", () => {
    expect(
      parseClientMessage({
        type: "rewind_session",
        sessionId: "s1",
        checkpointId: "cp1",
      }),
    ).toEqual({ type: "rewind_session", sessionId: "s1", checkpointId: "cp1" });
    expect(parseClientMessage({ type: "revert_last", sessionId: "s1" })).toEqual({
      type: "revert_last",
      sessionId: "s1",
    });
    expect(parseClientMessage({ type: "compact_session", sessionId: "s1" })).toEqual({
      type: "compact_session",
      sessionId: "s1",
    });
  });

  it("rejects invalid decision", () => {
    const msg = parseClientMessage({ type: "approval_decision", approvalId: "a1", decision: "bad" });
    expect(msg.type).toBe("error");
  });

  it("rejects missing type", () => {
    const msg = parseClientMessage({ sessionId: "abc" });
    expect(msg.type).toBe("error");
  });

  it("rejects non-object", () => {
    expect(parseClientMessage(null).type).toBe("error");
    expect(parseClientMessage("hello").type).toBe("error");
    expect(parseClientMessage(42).type).toBe("error");
  });

  it("rejects unknown type", () => {
    const msg = parseClientMessage({ type: "do_something" });
    expect(msg.type).toBe("error");
    if (msg.type === "error") expect(msg.message).toContain("Unknown");
  });

  it("rejects user_message with missing text", () => {
    const msg = parseClientMessage({ type: "user_message", sessionId: "s1" });
    expect(msg.type).toBe("error");
  });
});

describe("HTTP API", () => {
  it("GET /api/health returns ok", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const { port } = await startTestServer(store);
    const data = await fetchJson(port, "/api/health");
    expect(data).toEqual({ ok: true });
  });

  it("GET /api/config does not expose secrets", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const { port } = await startTestServer(store);
    const data = await fetchJson(port, "/api/config");
    expect(data.cwd).toBe("/test");
    expect(data.provider).toBe("openai");
    expect(data.model).toBe("test-model");
    expect(Object.keys(data)).not.toContain("apiKey");
    expect(Object.keys(data)).not.toContain("authToken");
  });

  it("POST /api/sessions creates session", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const { port } = await startTestServer(store);
    const data = await fetchJson(port, "/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(data.id).toBeTruthy();
    expect(data.cwd).toBeTruthy();
  });

  it("GET /api/sessions lists sessions", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const { port } = await startTestServer(store);
    await fetchJson(port, "/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const list = await fetchJson(port, "/api/sessions");
    expect(list).toHaveLength(1);
  });

  it("GET /api/sessions/:id/messages returns messages", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const session = store.createSession({ workspaceRoot: "/test" });
    store.appendMessages(session.id, [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
    const { port } = await startTestServer(store);
    const msgs = await fetchJson(port, `/api/sessions/${session.id}/messages`);
    expect(msgs).toHaveLength(2);
  });

  it("GET / returns HTML", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const { port } = await startTestServer(store);
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("myAgent");
    expect(html).toContain("--canvas: #f5f6f2");
    expect(html).toContain("/assets/client.js");
    expect(html).toContain('<div id="root"></div>');
    expect(html).not.toContain('id="session-list"');
    expect(html).not.toContain("Copy ID");
  });

  it("GET /assets/client.js returns bundled app client", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const { port } = await startTestServer(store);
    const res = await fetch(`http://127.0.0.1:${port}/assets/client.js`);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    const js = await res.text();
    expect(js).toContain("localStorage");
    expect(js).toContain("activeSession");
    expect(js).toContain("createRoot");
    expect(js).toContain("useReducer");
    expect(js).toContain("Gathered context");
    expect(js).toContain("approval-file-list");
    expect(js).toContain("approval-inline-diff");
    expect(js).toContain("Review changes");
    expect(js).toContain("review-file");
    expect(js).toContain("turn-review-toggle");
    expect(js).toContain("ApprovalDock");
    expect(js).toContain("Submit");
    expect(js).not.toContain("__myAgentMarkdown");
    expect(js).not.toContain('querySelector(".tool-stack")');
    expect(js.length).toBeLessThan(800_000);
  });

  it("serves split client chunks for markdown rendering", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const { port } = await startTestServer(store);
    const client = await fetch(`http://127.0.0.1:${port}/assets/client.js`).then((r) => r.text());
    const chunks = Array.from(client.matchAll(/["']\.\/(chunks\/[^"']+\.js)["']/g)).map(
      (match) => `/assets/${match[1]}`,
    );
    expect(chunks.length).toBeGreaterThan(0);

    let markdownSource = client.includes("remarkGfm") ? client : "";
    for (const chunk of chunks) {
      const res = await fetch(`http://127.0.0.1:${port}${chunk}`);
      expect(res.headers.get("content-type")).toContain("text/javascript");
      const js = await res.text();
      if (js.includes("markdown-body") && js.includes("remarkGfm")) {
        markdownSource = js;
        break;
      }
    }

    expect(markdownSource).toContain("remarkGfm");
    expect(markdownSource).toContain("markdown-body");
  });
});

describe("WebSocket", () => {
  it("malformed JSON returns error", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const { port } = await startTestServer(store);
    const msg = await wsRoundTrip(port, (ws) => ws.send("not json"));
    expect(msg.type).toBe("error");
    expect(msg.message).toContain("Invalid JSON");
  });

  it("unknown message type returns error", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const { port } = await startTestServer(store);
    const msg = await wsRoundTrip(port, (ws) =>
      ws.send(JSON.stringify({ type: "explode" })),
    );
    expect(msg.type).toBe("error");
    expect(msg.message).toContain("Unknown");
  });

  it("subscribe to unknown session returns error", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const { port } = await startTestServer(store);
    const msg = await wsRoundTrip(port, (ws) =>
      ws.send(JSON.stringify({ type: "subscribe_session", sessionId: "nonexistent" })),
    );
    expect(msg.type).toBe("error");
  });

  it("subscribes to an existing persisted session", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const session = store.createSession({ workspaceRoot: "/test" });
    const { port } = await startTestServer(store);
    const msg = await wsRoundTrip(port, (ws) =>
      ws.send(JSON.stringify({ type: "subscribe_session", sessionId: session.id })),
    );
    expect(msg).toEqual({ type: "ready", sessionId: session.id });
  });

  it("user_message on nonexistent session returns error", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const { port } = await startTestServer(store);
    const msg = await wsRoundTrip(port, (ws) =>
      ws.send(JSON.stringify({ type: "user_message", sessionId: "nonexistent", text: "hi" })),
    );
    expect(msg.type).toBe("error");
    expect(msg.message).toContain("Session not found");
  });

  it("runs a turn for an existing persisted session", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const session = store.createSession({ workspaceRoot: "/test" });
    const { port } = await startTestServer(store);
    const messages = await wsCollect(port, (ws) => {
      ws.send(JSON.stringify({ type: "subscribe_session", sessionId: session.id }));
      ws.send(JSON.stringify({ type: "user_message", sessionId: session.id, text: "hi" }));
    }, (msg) => msg.type === "turn_finished");

    expect(messages.some((msg) => msg.type === "ready")).toBe(true);
    expect(
      messages.some(
        (msg) => msg.type === "turn_event" && msg.event.type === "assistant_text_delta",
      ),
    ).toBe(true);
    expect(store.getSession(session.id)?.messages.some((m) => m.role === "user")).toBe(true);
  });

  it("rewinds a session over websocket", async () => {
    const base = await tmpBaseDir();
    const workspace = await tmpBaseDir();
    const store = openTestStore(base);
    await writeFile(join(workspace, "a.txt"), "before");
    const checkpoint = await createCheckpoint(workspace, ["a.txt"]);
    await writeFile(join(workspace, "a.txt"), "after");
    const session = store.createSession({ workspaceRoot: workspace });
    const { port } = await startTestServer(store);

    const messages = await wsCollect(port, (ws) => {
      ws.send(JSON.stringify({ type: "subscribe_session", sessionId: session.id }));
      ws.send(
        JSON.stringify({
          type: "rewind_session",
          sessionId: session.id,
          checkpointId: checkpoint.id,
        }),
      );
    }, (msg) => msg.type === "session_rewound");

    const rewound = messages.find((msg) => msg.type === "session_rewound");
    expect(rewound.checkpointId).toBe(checkpoint.id);
    expect(await readFile(join(workspace, "a.txt"), "utf-8")).toBe("before");
    expect(store.getSession(session.id)?.messages.at(-1)?.content).toContain(checkpoint.id);
  });

  it("rejects revert while a turn is active", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const session = store.createSession({ workspaceRoot: "/test" });
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const port = await findAvailablePort(43200);
    const server = createAppServer({
      provider: delayedProvider(blocker),
      providerName: "openai",
      modelName: "test-model",
      registry: new ToolRegistry(),
      approval: "auto",
      store,
      cwd: "/test",
    });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(port, "127.0.0.1", () => resolve());
    });

    const messages = await wsCollect(port, (ws) => {
      ws.send(JSON.stringify({ type: "subscribe_session", sessionId: session.id }));
      ws.send(JSON.stringify({ type: "user_message", sessionId: session.id, text: "hi" }));
      setTimeout(() => {
        ws.send(JSON.stringify({ type: "revert_last", sessionId: session.id }));
      }, 20);
    }, (msg) => msg.type === "error" && msg.code === "REVERT_REJECTED");

    expect(messages.at(-1)?.message).toContain("Turn already active");
    release();
  });

  it("compacts a session over websocket", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const session = store.createSession({ workspaceRoot: "/test" });
    store.appendMessages(session.id, [
      { role: "user", content: "first" },
      { role: "assistant", content: "first reply" },
      { role: "user", content: "second" },
    ]);
    const port = await findAvailablePort(43200);
    const server = createAppServer({
      provider: summaryProvider("Summary of first turn"),
      providerName: "openai",
      modelName: "test-model",
      registry: new ToolRegistry(),
      approval: "auto",
      store,
      cwd: "/test",
    });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(port, "127.0.0.1", () => resolve());
    });

    const messages = await wsCollect(port, (ws) => {
      ws.send(JSON.stringify({ type: "subscribe_session", sessionId: session.id }));
      ws.send(JSON.stringify({ type: "compact_session", sessionId: session.id }));
    }, (msg) => msg.type === "session_compacted");

    const compacted = messages.find((msg) => msg.type === "session_compacted");
    expect(compacted).toMatchObject({
      compactedCount: 2,
      retainedCount: 1,
      message: "Compacted 2 messages; retained 1 messages.",
    });
    expect(store.getSession(session.id)?.messages).toEqual([
      { role: "summary", content: "Summary of first turn" },
      { role: "user", content: "second" },
    ]);
  });
});

describe("SessionManager", () => {
  it("persists the user message before the provider turn completes", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const session = store.createSession({ workspaceRoot: "/test" });
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manager = new SessionManager({
      provider: delayedProvider(blocker),
      registry: new ToolRegistry(),
      approval: "auto",
      store,
      sendEvent: () => {},
    });
    manager.registerSession(session);

    const result = manager.handleUserMessage(session.id, "hi");

    expect(result).toEqual({ ok: true });
    expect(manager.hasActiveTurn(session.id)).toBe(true);
    expect(store.getSession(session.id)?.messages).toEqual([
      { role: "user", content: "hi" },
    ]);

    release();
    await waitForCondition(
      () => !manager.hasActiveTurn(session.id),
      "turn did not finish",
    );

    expect(store.getSession(session.id)?.messages).toEqual([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "ok",
        parts: [{ type: "text", text: "ok" }],
      },
    ]);
  });

  it("allows different sessions to run turns concurrently", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const first = store.createSession({ workspaceRoot: "/test" });
    const second = store.createSession({ workspaceRoot: "/test" });
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manager = new SessionManager({
      provider: delayedProvider(blocker),
      registry: new ToolRegistry(),
      approval: "auto",
      store,
      sendEvent: () => {},
    });
    manager.registerSession(first);
    manager.registerSession(second);

    expect(manager.handleUserMessage(first.id, "first")).toEqual({ ok: true });
    expect(manager.handleUserMessage(second.id, "second")).toEqual({ ok: true });
    expect(manager.hasActiveTurn(first.id)).toBe(true);
    expect(manager.hasActiveTurn(second.id)).toBe(true);

    release();
    await waitForCondition(
      () => !manager.hasActiveTurn(first.id) && !manager.hasActiveTurn(second.id),
      "turns did not finish",
    );

    expect(store.getSession(first.id)?.messages.map((m) => m.content)).toEqual([
      "first",
      "ok",
    ]);
    expect(store.getSession(second.id)?.messages.map((m) => m.content)).toEqual([
      "second",
      "ok",
    ]);
  });

  it("sends the real turn failure message", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const session = store.createSession({ workspaceRoot: "/test" });
    const events: unknown[] = [];
    const manager = new SessionManager({
      provider: throwingProvider(new Error("boom")),
      registry: new ToolRegistry(),
      approval: "auto",
      store,
      sendEvent: (_sessionId, event) => events.push(event),
    });
    manager.registerSession(session);

    expect(manager.handleUserMessage(session.id, "hi")).toEqual({ ok: true });
    await waitForCondition(
      () => !manager.hasActiveTurn(session.id),
      "turn did not finish",
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        code: "TURN_ERROR",
        message: "Turn failed: boom",
      }),
    );
  });

  it("formats provider turn failures for the web app", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const session = store.createSession({ workspaceRoot: "/test" });
    const events: unknown[] = [];
    const manager = new SessionManager({
      provider: throwingProvider(
        new ProviderRuntimeError("openai", "auth", "bad key", {
          status: 401,
          hint: "check credentials",
          requestId: "req_1",
        }),
      ),
      registry: new ToolRegistry(),
      approval: "auto",
      store,
      sendEvent: (_sessionId, event) => events.push(event),
    });
    manager.registerSession(session);

    expect(manager.handleUserMessage(session.id, "hi")).toEqual({ ok: true });
    await waitForCondition(
      () => !manager.hasActiveTurn(session.id),
      "turn did not finish",
    );

    const error = events.find(
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: string }).type === "error",
    ) as { message?: string } | undefined;

    expect(error?.message).toContain("Provider error [openai/auth]: bad key");
    expect(error?.message).toContain("Hint: check credentials");
    expect(error?.message).toContain("Status: 401");
    expect(error?.message).toContain("Request ID: req_1");
  });
});

describe("findAvailablePort", () => {
  it("returns a port number", async () => {
    const port = await findAvailablePort(43300);
    expect(port).toBeGreaterThanOrEqual(43300);
    expect(port).toBeLessThan(65536);
  });
});

function wsRoundTrip(port: number, onOpen: (ws: WebSocket) => void): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    activeWs.push(ws);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("WS timeout"));
    }, 3000);
    ws.on("open", () => onOpen(ws));
    ws.on("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function wsCollect(
  port: number,
  onOpen: (ws: WebSocket) => void,
  done: (msg: any) => boolean,
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    activeWs.push(ws);
    const messages: any[] = [];
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("WS timeout"));
    }, 3000);
    ws.on("open", () => onOpen(ws));
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      messages.push(msg);
      if (done(msg)) {
        clearTimeout(timer);
        resolve(messages);
      }
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
