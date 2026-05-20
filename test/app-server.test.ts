import { describe, expect, it, afterEach } from "vitest";
import { parseClientMessage } from "../src/app/protocol.js";
import { createAppServer, findAvailablePort } from "../src/app/server.js";
import { SessionManager } from "../src/app/session-api.js";
import { ProviderRuntimeError } from "../src/model/errors.js";
import type { Provider } from "../src/model/provider.js";
import type { TranscriptStore } from "../src/storage/store.js";
import { openStore } from "../src/storage/store.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { WebSocket } from "ws";
import { createCheckpoint } from "../src/workspace/checkpoint.js";

const execFileAsync = promisify(execFile);

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

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

function testRuntime(provider: Provider = noopProvider()) {
  return {
    provider,
    modelProfiles: [
      {
        id: "openai/test-model",
        provider: "openai",
        adapter: "@ai-sdk/openai" as const,
        model: "test-model",
        apiKey: "sk-test",
      },
    ],
    createProvider: () => provider,
    registry: new ToolRegistry(),
    approval: "on-request" as const,
  };
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

function skillProbeProvider(): Provider {
  return {
    name: "test",
    async *stream(messages, tools, options) {
      const prompt = options?.systemPrompt ?? "";
      const lastToolResult = [...messages]
        .reverse()
        .find((message) => message.role === "tool_result" && message.toolName === "skill");
      if (lastToolResult?.content.includes('<skill_content name="changed-skill">')) {
        yield { type: "text" as const, delta: "loaded changed-skill" };
        yield { type: "finish" as const, reason: "stop" as const };
        return;
      }
      if (prompt.includes("changed-skill")) {
        yield {
          type: "tool-call" as const,
          id: "call_skill",
          name: "skill",
          input: { name: "changed-skill" },
        };
        yield { type: "finish" as const, reason: "tool-calls" as const };
        return;
      }
      const toolNames = (tools ?? []).map((tool) => tool.name).join(",");
      yield { type: "text" as const, delta: `tools:${toolNames}` };
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

function textProvider(name: string, text: string): Provider {
  return {
    name,
    async *stream() {
      yield { type: "text" as const, delta: text };
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
    modelProfileId: "openai/test-model",
    modelProfiles: [
      {
        id: "openai/test-model",
        provider: "openai",
        adapter: "@ai-sdk/openai",
        model: "test-model",
        apiKey: "sk-test",
      },
    ],
    registry: new ToolRegistry(),
    approval: "on-request",
    resolveRuntime: () => testRuntime(),
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

  it("GET /provider returns public provider groups", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const { port } = await startTestServer(store);

    const data = await fetchJson(port, "/provider");

    expect(data).toEqual({
      all: [
        {
          id: "openai",
          name: "openai",
          adapters: ["@ai-sdk/openai"],
          defaultModel: "openai/test-model",
          models: [
            {
              id: "openai/test-model",
              provider: "openai",
              providerID: "openai",
              modelID: "test-model",
              adapter: "@ai-sdk/openai",
              model: "test-model",
              name: "test-model",
            },
          ],
        },
      ],
      connected: ["openai"],
      default: { openai: "openai/test-model" },
    });
    expect(JSON.stringify(data)).not.toContain("sk-test");
  });

  it("GET /config/providers returns public model config", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const { port } = await startTestServer(store);

    const data = await fetchJson(port, "/config/providers");

    expect(data).toEqual({
      current: "openai/test-model",
      providers: [
        {
          id: "openai",
          name: "openai",
          adapters: ["@ai-sdk/openai"],
          defaultModel: "openai/test-model",
          models: [
            {
              id: "openai/test-model",
              provider: "openai",
              providerID: "openai",
              modelID: "test-model",
              adapter: "@ai-sdk/openai",
              model: "test-model",
              name: "test-model",
            },
          ],
        },
      ],
      connected: ["openai"],
      default: { openai: "openai/test-model" },
      models: [
        {
          id: "openai/test-model",
          provider: "openai",
          providerID: "openai",
          modelID: "test-model",
          adapter: "@ai-sdk/openai",
          model: "test-model",
          name: "test-model",
        },
      ],
    });
    expect(JSON.stringify(data)).not.toContain("sk-test");
  });

  it("GET /project lists project summaries", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const session = store.createSession({ workspaceRoot: "/test" });
    const { port } = await startTestServer(store);

    const data = await fetchJson(port, "/project");

    expect(data).toEqual([
      expect.objectContaining({
        path: "/test",
        name: "test",
        sessionCount: 1,
        lastSessionId: session.id,
      }),
    ]);
  });

  it("POST /project creates an explicit project", async () => {
    const base = await tmpBaseDir();
    const workspace = await mkdtemp(join(tmpdir(), "myagent-project-api-"));
    const canonicalWorkspace = await realpath(workspace);
    activeTmpDirs.push(workspace);
    const store = openTestStore(base);
    const { port } = await startTestServer(store);

    const data = await fetchJson(port, "/project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: workspace, name: "API Project" }),
    });

    expect(data).toMatchObject({
      path: canonicalWorkspace,
      name: "API Project",
      sessionCount: 0,
    });
  });

  it("POST /project/pick creates a project from the native picker result", async () => {
    const base = await tmpBaseDir();
    const workspace = await mkdtemp(join(tmpdir(), "myagent-project-picker-"));
    const canonicalWorkspace = await realpath(workspace);
    activeTmpDirs.push(workspace);
    const store = openTestStore(base);
    const port = await findAvailablePort(43200);
    const server = createAppServer({
      provider: noopProvider(),
      providerName: "openai",
      modelName: "test-model",
      modelProfileId: "openai/test-model",
      modelProfiles: [
        {
          id: "openai/test-model",
          provider: "openai",
          adapter: "@ai-sdk/openai",
          model: "test-model",
          apiKey: "sk-test",
        },
      ],
      registry: new ToolRegistry(),
      approval: "on-request",
      resolveRuntime: () => testRuntime(),
      store,
      pickProjectDirectory: async () => workspace,
      cwd: "/test",
    });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(port, "127.0.0.1", () => resolve());
    });

    const data = await fetchJson(port, "/project/pick", {
      method: "POST",
    });

    expect(data).toMatchObject({
      path: canonicalWorkspace,
      name: canonicalWorkspace.split("/").pop(),
      sessionCount: 0,
    });
  });

  it("POST /project/pick reports cancellation without creating a project", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const port = await findAvailablePort(43200);
    const server = createAppServer({
      provider: noopProvider(),
      providerName: "openai",
      modelName: "test-model",
      modelProfileId: "openai/test-model",
      modelProfiles: [
        {
          id: "openai/test-model",
          provider: "openai",
          adapter: "@ai-sdk/openai",
          model: "test-model",
          apiKey: "sk-test",
        },
      ],
      registry: new ToolRegistry(),
      approval: "on-request",
      resolveRuntime: () => testRuntime(),
      store,
      pickProjectDirectory: async () => null,
      cwd: "/test",
    });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(port, "127.0.0.1", () => resolve());
    });

    const data = await fetchJson(port, "/project/pick", {
      method: "POST",
    });

    expect(data).toEqual({ canceled: true });
    expect(store.listProjects()).toEqual([]);
  });

  it("GET /session lists sessions with OpenCode-style path", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const session = store.createSession({ workspaceRoot: "/test" });
    const { port } = await startTestServer(store);

    const list = await fetchJson(port, "/session");

    expect(list).toEqual([
      expect.objectContaining({
        id: session.id,
        projectPath: "/test",
        workspaceRoot: "/test",
      }),
    ]);
  });

  it("POST /session creates a project-bound session", async () => {
    const base = await tmpBaseDir();
    const workspace = await mkdtemp(join(tmpdir(), "myagent-session-api-"));
    const canonicalWorkspace = await realpath(workspace);
    activeTmpDirs.push(workspace);
    const store = openTestStore(base);
    const { port } = await startTestServer(store);

    const data = await fetchJson(port, "/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectPath: workspace }),
    });

    expect(data).toMatchObject({
      id: expect.any(String),
      projectPath: canonicalWorkspace,
      workspaceRoot: canonicalWorkspace,
      cwd: canonicalWorkspace,
      provider: "openai",
      model: "test-model",
    });
    expect(store.getSession(data.id)?.cwd).toBe(canonicalWorkspace);
  });

  it("POST /session accepts a selected model profile", async () => {
    const base = await tmpBaseDir();
    const workspace = await mkdtemp(join(tmpdir(), "myagent-session-model-api-"));
    const canonicalWorkspace = await realpath(workspace);
    activeTmpDirs.push(workspace);
    const store = openTestStore(base);
    const { port } = await startTestServer(store);

    const data = await fetchJson(port, "/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectPath: workspace,
        modelProfileId: "openai/test-model",
      }),
    });

    expect(data).toMatchObject({
      id: expect.any(String),
      projectPath: canonicalWorkspace,
      modelProfileId: "openai/test-model",
      provider: "openai",
      model: "test-model",
    });
    expect(store.getSession(data.id)).toMatchObject({
      modelProfileId: "openai/test-model",
      provider: "openai",
      model: "test-model",
    });
  });

  it("POST /session rejects an unknown selected model profile", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const { port } = await startTestServer(store);

    const data = await fetchJson(port, "/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectPath: "/test",
        modelProfileId: "openai/missing",
      }),
    });

    expect(data).toEqual({ error: "Unknown model profile: openai/missing" });
  });

  it("GET /session/status reports idle and busy sessions", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const session = store.createSession({ workspaceRoot: "/test" });
    const port = await findAvailablePort(43200);
    const provider = delayedProvider(blocker);
    const server = createAppServer({
      provider,
      providerName: "openai",
      modelName: "test-model",
      registry: new ToolRegistry(),
      approval: "auto",
      resolveRuntime: () => ({ ...testRuntime(provider), approval: "auto" }),
      store,
      cwd: "/test",
    });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(port, "127.0.0.1", () => resolve());
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    activeWs.push(ws);
    await new Promise<void>((resolve) => ws.once("open", resolve));
    ws.send(JSON.stringify({ type: "user_message", sessionId: session.id, text: "hello" }));
    await waitForCondition(
      () => store.getSession(session.id)!.messages.length > 0,
      "turn did not start",
    );

    expect(await fetchJson(port, "/session/status")).toEqual([
      { id: session.id, status: "busy" },
    ]);

    release();
    await waitForCondition(
      () => store.getSession(session.id)!.messages.some((message) => message.role === "assistant"),
      "turn did not finish",
    );
  });

  it("GET /session/:id/message returns messages", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const session = store.createSession({ workspaceRoot: "/test" });
    store.appendMessages(session.id, [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
    const { port } = await startTestServer(store);

    const msgs = await fetchJson(port, `/session/${session.id}/message`);

    expect(msgs).toHaveLength(2);
  });

  it("GET /session/:id/diff returns unified diff files", async () => {
    const base = await tmpBaseDir();
    const workspace = await mkdtemp(join(tmpdir(), "myagent-session-diff-"));
    activeTmpDirs.push(workspace);
    await runGit(workspace, ["init"]);
    await runGit(workspace, ["config", "user.email", "test@example.com"]);
    await runGit(workspace, ["config", "user.name", "Test"]);
    await writeFile(join(workspace, "file.txt"), "old\n");
    await runGit(workspace, ["add", "file.txt"]);
    await runGit(workspace, ["commit", "-m", "init"]);
    await writeFile(join(workspace, "file.txt"), "old\nnew\n");

    const store = openTestStore(base);
    const session = store.createSession({ workspaceRoot: workspace });
    const { port } = await startTestServer(store);

    const data = await fetchJson(port, `/session/${session.id}/diff`);

    expect(data).toMatchObject({
      sessionId: session.id,
      files: [expect.objectContaining({ path: "file.txt", additions: 1 })],
    });
    expect(data.diff).toContain("+new");
  });

  it("GET / returns HTML", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const { port } = await startTestServer(store);
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("myAgent");
    expect(html).toContain("--canvas: #f9f9f9");
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
    expect(js).toContain("diff-card");
    expect(js).toContain("diff-card-file");
    expect(js).toContain("diff-card-toggle");
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

  it("reports model configuration errors instead of using a fallback model", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const session = store.createSession({ workspaceRoot: "/test" });
    const port = await findAvailablePort(43200);
    const server = createAppServer({
      provider: throwingProvider(
        new Error("No model configured. Add `model` or `provider.<name>.models` to your myAgent config."),
      ),
      providerName: "anthropic",
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
    }, (msg) => msg.type === "error" && msg.code === "TURN_ERROR");

    expect(messages.find((msg) => msg.type === "error")).toMatchObject({
      type: "error",
      code: "TURN_ERROR",
      message: "Turn failed: No model configured. Add `model` or `provider.<name>.models` to your myAgent config.",
    });
  });

  it("refreshes project skills on the next turn without rebuilding the provider", async () => {
    const base = await tmpBaseDir();
    const workspace = await mkdtemp(join(tmpdir(), "myagent-app-skill-refresh-"));
    const home = await tmpBaseDir();
    const myagentHome = await tmpBaseDir();
    activeTmpDirs.push(workspace);
    const store = openTestStore(base);
    const session = store.createSession({ workspaceRoot: workspace });
    const port = await findAvailablePort(43200);
    const provider = skillProbeProvider();
    let createProviderCalls = 0;
    const server = createAppServer({
      provider,
      providerName: "openai",
      modelName: "test-model",
      modelProfileId: "openai/test-model",
      modelProfiles: [
        {
          id: "openai/test-model",
          provider: "openai",
          adapter: "@ai-sdk/openai",
          model: "test-model",
          apiKey: "sk-test",
        },
      ],
      createProvider: () => {
        createProviderCalls++;
        return provider;
      },
      registry: new ToolRegistry(),
      approval: "auto",
      skillRootOptions: { homeDir: home, myagentHome },
      store,
      cwd: workspace,
    });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(port, "127.0.0.1", () => resolve());
    });

    const firstTurn = await wsCollect(port, (ws) => {
      ws.send(JSON.stringify({ type: "subscribe_session", sessionId: session.id }));
      ws.send(JSON.stringify({ type: "user_message", sessionId: session.id, text: "before" }));
    }, (msg) => msg.type === "turn_finished");
    expect(
      firstTurn.some(
        (msg) =>
          msg.type === "turn_event" &&
          msg.event.type === "assistant_text_delta" &&
          msg.event.text.includes("tools:Read,grep,edit_file,write_file,bash,list_dir,apply_patch,glob"),
      ),
    ).toBe(true);
    const firstText = firstTurn
      .filter((msg) => msg.type === "turn_event" && msg.event.type === "assistant_text_delta")
      .map((msg) => msg.event.text)
      .join("");
    expect(firstText.split(",")).not.toContain("skill");

    const skillDir = join(workspace, ".agents", "skills", "changed-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: changed-skill\ndescription: Test hot skill refresh.\n---\n# Changed Skill\n",
    );
    const providerCallsBeforeSkillRefreshTurn = createProviderCalls;

    const secondTurn = await wsCollect(port, (ws) => {
      ws.send(JSON.stringify({ type: "subscribe_session", sessionId: session.id }));
      ws.send(JSON.stringify({ type: "user_message", sessionId: session.id, text: "after" }));
    }, (msg) => msg.type === "turn_finished");

    expect(
      secondTurn.some(
        (msg) =>
          msg.type === "turn_event" &&
          msg.event.type === "tool_call" &&
          msg.event.name === "skill",
      ),
    ).toBe(true);
    expect(
      secondTurn.some(
        (msg) =>
          msg.type === "turn_event" &&
          msg.event.type === "assistant_text_delta" &&
          msg.event.text === "loaded changed-skill",
      ),
    ).toBe(true);
    expect(createProviderCalls).toBe(providerCallsBeforeSkillRefreshTurn);
  });

  it("switches model over websocket and uses the new provider for the next turn", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const session = store.createSession({
      workspaceRoot: "/test",
      modelProfileId: "openai/first",
      provider: "openai",
      model: "first",
    });
    const providers = {
      "openai/first": textProvider("first", "first provider"),
      "mimo-claude/second": textProvider("second", "second provider"),
    };
    const port = await findAvailablePort(43200);
    const server = createAppServer({
      provider: providers["openai/first"],
      providerName: "openai",
      modelName: "first",
      modelProfileId: "openai/first",
      modelProfiles: [
        {
          id: "openai/first",
          provider: "openai",
          adapter: "@ai-sdk/openai",
          model: "first",
          apiKey: "sk-test",
        },
        {
          id: "mimo-claude/second",
          provider: "mimo-claude",
          adapter: "@ai-sdk/anthropic",
          model: "second",
          authToken: "sk-test",
        },
      ],
      createProvider: (profile) => providers[profile.id as keyof typeof providers],
      registry: new ToolRegistry(),
      approval: "auto",
      resolveRuntime: () => ({
        provider: providers["openai/first"],
        modelProfiles: [
          {
            id: "openai/first",
            provider: "openai",
            adapter: "@ai-sdk/openai",
            model: "first",
            apiKey: "sk-test",
          },
          {
            id: "mimo-claude/second",
            provider: "mimo-claude",
            adapter: "@ai-sdk/anthropic",
            model: "second",
            authToken: "sk-test",
          },
        ],
        createProvider: (profile) => providers[profile.id as keyof typeof providers],
        registry: new ToolRegistry(),
        approval: "auto",
      }),
      store,
      cwd: "/test",
    });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(port, "127.0.0.1", () => resolve());
    });

    const switchMessages = await wsCollect(port, (ws) => {
      ws.send(JSON.stringify({ type: "subscribe_session", sessionId: session.id }));
      ws.send(
        JSON.stringify({
          type: "user_message",
          sessionId: session.id,
          text: "/model mimo-claude/second",
        }),
      );
    }, (msg) => msg.type === "session_model_changed");

    const switched = switchMessages.find((msg) => msg.type === "session_model_changed");
    expect(switched).toMatchObject({
      type: "session_model_changed",
      modelProfileId: "mimo-claude/second",
      provider: "mimo-claude",
      model: "second",
    });
    expect(store.getSession(session.id)).toMatchObject({
      modelProfileId: "mimo-claude/second",
      provider: "mimo-claude",
      model: "second",
    });

    const runMessages = await wsCollect(port, (ws) => {
      ws.send(JSON.stringify({ type: "subscribe_session", sessionId: session.id }));
      ws.send(JSON.stringify({ type: "user_message", sessionId: session.id, text: "hi" }));
    }, (msg) => msg.type === "turn_finished");

    expect(
      runMessages.some(
        (msg) =>
          msg.type === "turn_event" &&
          msg.event.type === "assistant_text_delta" &&
          msg.event.text === "second provider",
      ),
    ).toBe(true);
  });

  it("switches model over HTTP and uses the new provider for the next turn", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const session = store.createSession({
      workspaceRoot: "/test",
      modelProfileId: "openai/first",
      provider: "openai",
      model: "first",
    });
    const providers = {
      "openai/first": textProvider("first", "first provider"),
      "mimo/second": textProvider("second", "second provider"),
    };
    const port = await findAvailablePort(43200);
    const server = createAppServer({
      provider: providers["openai/first"],
      providerName: "openai",
      modelName: "first",
      modelProfileId: "openai/first",
      modelProfiles: [
        {
          id: "openai/first",
          provider: "openai",
          adapter: "@ai-sdk/openai",
          model: "first",
          apiKey: "sk-test",
        },
        {
          id: "mimo/second",
          provider: "mimo",
          adapter: "@ai-sdk/openai-compatible",
          model: "second",
          apiKey: "sk-test",
        },
      ],
      createProvider: (profile) => providers[profile.id as keyof typeof providers],
      registry: new ToolRegistry(),
      approval: "auto",
      resolveRuntime: () => ({
        provider: providers["openai/first"],
        modelProfiles: [
          {
            id: "openai/first",
            provider: "openai",
            adapter: "@ai-sdk/openai",
            model: "first",
            apiKey: "sk-test",
          },
          {
            id: "mimo/second",
            provider: "mimo",
            adapter: "@ai-sdk/openai-compatible",
            model: "second",
            apiKey: "sk-test",
          },
        ],
        createProvider: (profile) => providers[profile.id as keyof typeof providers],
        registry: new ToolRegistry(),
        approval: "auto",
      }),
      store,
      cwd: "/test",
    });
    activeServers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(port, "127.0.0.1", () => resolve());
    });

    const switched = await fetchJson(port, `/session/${session.id}/model`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelProfileId: "mimo/second" }),
    });

    expect(switched).toMatchObject({
      ok: true,
      modelProfileId: "mimo/second",
      provider: "mimo",
      model: "second",
    });
    expect(store.getSession(session.id)).toMatchObject({
      modelProfileId: "mimo/second",
      provider: "mimo",
      model: "second",
    });

    const runMessages = await wsCollect(port, (ws) => {
      ws.send(JSON.stringify({ type: "subscribe_session", sessionId: session.id }));
      ws.send(JSON.stringify({ type: "user_message", sessionId: session.id, text: "hi" }));
    }, (msg) => msg.type === "turn_finished");

    expect(
      runMessages.some(
        (msg) =>
          msg.type === "turn_event" &&
          msg.event.type === "assistant_text_delta" &&
          msg.event.text === "second provider",
      ),
    ).toBe(true);
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
    const provider = delayedProvider(blocker);
    const server = createAppServer({
      provider,
      providerName: "openai",
      modelName: "test-model",
      registry: new ToolRegistry(),
      approval: "auto",
      resolveRuntime: () => ({ ...testRuntime(provider), approval: "auto" }),
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
      { role: "assistant", content: "second reply" },
      { role: "user", content: "third" },
    ]);
    const port = await findAvailablePort(43200);
    const provider = summaryProvider("Summary of first turn");
    const server = createAppServer({
      provider,
      providerName: "openai",
      modelName: "test-model",
      registry: new ToolRegistry(),
      approval: "auto",
      resolveRuntime: () => ({ ...testRuntime(provider), approval: "auto" }),
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
      retainedCount: 3,
      message: "Compacted 2 messages; retained 3 messages.",
    });
    expect(store.getSession(session.id)?.messages).toEqual([
      expect.objectContaining({ role: "summary", content: "Summary of first turn" }),
      { role: "user", content: "second" },
      { role: "assistant", content: "second reply" },
      { role: "user", content: "third" },
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
        parts: [{ type: "text", text: "ok", phase: "final" }],
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
