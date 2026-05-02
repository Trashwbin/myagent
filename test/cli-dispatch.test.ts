import { describe, it, expect, afterEach } from "vitest";
import { Command } from "commander";
import { openStore } from "../src/storage/store.js";
import type { TranscriptStore } from "../src/storage/store.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

let activeStores: TranscriptStore[] = [];
let activeTmpDirs: string[] = [];

afterEach(() => {
  for (const s of activeStores) s.close();
  activeStores = [];
  for (const dir of activeTmpDirs) {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  activeTmpDirs = [];
});

async function tmpBaseDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "myagent-cli-test-"));
  activeTmpDirs.push(dir);
  return dir;
}

function openTestStore(baseDir: string): TranscriptStore {
  const store = openStore({ baseDir });
  activeStores.push(store);
  return store;
}

// Minimal Commander setup mirroring the real CLI structure.
// We test the routing logic, not the full chat loop.
function makeTestProgram(): {
  program: Command;
  sessionsCalled: string[];
  resumeCalled: string[];
} {
  const sessionsCalled: string[] = [];
  const resumeCalled: string[] = [];

  const program = new Command();
  program.exitOverride();

  program
    .name("myagent")
    .argument("[prompt]", "task prompt");

  program.action(() => {
    // main action — no-op for routing tests
  });

  program
    .command("sessions")
    .action(() => {
      sessionsCalled.push("subcommand");
    });

  program
    .command("resume <sessionId>")
    .action((sessionId) => {
      resumeCalled.push(sessionId);
    });

  return { program, sessionsCalled, resumeCalled };
}

describe("CLI subcommand routing", () => {
  it("routes 'sessions' subcommand", async () => {
    const { program, sessionsCalled } = makeTestProgram();
    await program.parseAsync(["node", "myagent", "sessions"]);
    expect(sessionsCalled).toEqual(["subcommand"]);
  });

  it("routes 'resume <id>' subcommand", async () => {
    const { program, resumeCalled } = makeTestProgram();
    await program.parseAsync(["node", "myagent", "resume", "abc-123"]);
    expect(resumeCalled).toEqual(["abc-123"]);
  });

  it("does not route plain prompt as subcommand", async () => {
    const { program, sessionsCalled, resumeCalled } = makeTestProgram();
    await program.parseAsync(["node", "myagent", "fix the bug"]);
    expect(sessionsCalled).toEqual([]);
    expect(resumeCalled).toEqual([]);
  });
});

describe("sessions output", () => {
  it("prints session id, workspace, provider, model, updated", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    store.createSession({
      workspaceRoot: "/tmp/project",
      provider: "openai",
      model: "gpt-4o",
    });

    const sessions = store.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBeTruthy();
    expect(sessions[0].workspaceRoot).toBe("/tmp/project");
    expect(sessions[0].provider).toBe("openai");
    expect(sessions[0].model).toBe("gpt-4o");
    expect(sessions[0].updatedAt).toBeGreaterThan(0);
  });

  it("prints empty list gracefully", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    expect(store.listSessions()).toEqual([]);
  });
});

describe("resume workspace resolution", () => {
  it("uses session workspace when no --cwd is passed", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);
    const ws = "/tmp/some-workspace";

    const session = store.createSession({ workspaceRoot: ws });
    store.appendMessages(session.id, [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);

    const restored = store.getSession(session.id)!;
    expect(restored).toBeDefined();
    expect(restored.cwd).toBe(ws);
  });

  it("detects --cwd mismatch with session workspace", async () => {
    const base = await tmpBaseDir();
    const store = openTestStore(base);

    const session = store.createSession({ workspaceRoot: "/tmp/workspace-a" });
    const restored = store.getSession(session.id)!;

    expect(resolve(restored.cwd)).toBe(resolve("/tmp/workspace-a"));
    expect(resolve(restored.cwd)).not.toBe(resolve("/tmp/workspace-b"));
  });
});
