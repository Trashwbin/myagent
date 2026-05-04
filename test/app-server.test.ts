import { describe, expect, it, afterEach } from "vitest";
import { parseClientMessage } from "../src/app/protocol.js";
import { createAppServer, findAvailablePort } from "../src/app/server.js";
import type { Provider } from "../src/model/provider.js";
import type { TranscriptStore } from "../src/storage/store.js";
import { openStore } from "../src/storage/store.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocket } from "ws";

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
      yield { type: "text_delta" as const, text: "ok" };
      yield { type: "stop" as const, reason: "end_turn" as const };
    },
  };
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
    expect(html).toContain("#fffaf0");
    expect(html).toContain("/assets/client.js");
    expect(html).toContain("Copy ID");
    expect(html).toContain("Always this session");
    expect(html).toContain("Always in workspace");
    expect(html).toContain(">Deny</button>");
    expect(html).not.toContain(">Abort</button>");
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
    expect(js).toContain("__myAgentMarkdown");
    expect(js).toContain("Create directory?");
    expect(js).toContain("approval-file-list");
    expect(js).toContain("approval-inline-diff");
    expect(js).toContain("tool-diff-list");
    expect(js).toContain("parseUnifiedDiffFiles");
    expect(js).toContain("Do you want to make these changes?");
    expect(js).toContain("activeToolStack");
    expect(js).toContain("rememberToolCall");
    expect(js).not.toContain("JSON.stringify(request.input");
    expect(js).not.toContain("Show diff");
    expect(js).not.toContain('querySelector(".tool-stack")');
    expect(js).not.toContain("react-markdown");
    expect(js.length).toBeLessThan(100_000);
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

    let markdownChunk = "";
    for (const chunk of chunks) {
      const res = await fetch(`http://127.0.0.1:${port}${chunk}`);
      expect(res.headers.get("content-type")).toContain("text/javascript");
      const js = await res.text();
      if (js.includes("markdown-body") && js.includes("remarkGfm")) {
        markdownChunk = js;
        break;
      }
    }

    expect(markdownChunk).toContain("renderAssistantMarkdown");
    expect(markdownChunk).toContain("remarkGfm");
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
