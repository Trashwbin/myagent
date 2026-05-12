import { describe, it, expect, afterEach } from "vitest";
import { Command } from "commander";
import { openStore } from "../src/storage/store.js";
import type { TranscriptStore } from "../src/storage/store.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createCheckpoint, restoreCheckpoint } from "../src/workspace/checkpoint.js";
import { revertLast } from "../src/session/revert.js";

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
  mainCalled: string[];
  sessionsCalled: string[];
  resumeCalled: Array<{ sessionId: string; cwd: string }>;
  tuiCalled: string[];
  rewindCalled: Array<{ sessionId: string; checkpointId: string }>;
  revertLastCalled: string[];
} {
  const mainCalled: string[] = [];
  const sessionsCalled: string[] = [];
  const resumeCalled: Array<{ sessionId: string; cwd: string }> = [];
  const tuiCalled: string[] = [];
  const rewindCalled: Array<{ sessionId: string; checkpointId: string }> = [];
  const revertLastCalled: string[] = [];

  const program = new Command();
  program.exitOverride();

  program.name("myagent");
  program.option("--cwd <path>", "working directory", process.cwd());

  program.action(() => {
    mainCalled.push("main");
  });

  program
    .command("sessions")
    .action(() => {
      sessionsCalled.push("subcommand");
    });

  program
    .command("resume <sessionId>")
    .action((sessionId) => {
      resumeCalled.push({ sessionId, cwd: program.opts<{ cwd: string }>().cwd });
    });

  program
    .command("rewind <sessionId> <checkpointId>")
    .action((sessionId, checkpointId) => {
      rewindCalled.push({ sessionId, checkpointId });
    });

  program
    .command("revert-last <sessionId>")
    .action((sessionId) => {
      revertLastCalled.push(sessionId);
    });

  program
    .command("tui")
    .action(() => {
      tuiCalled.push(program.opts<{ cwd: string }>().cwd);
    });

  return {
    program,
    mainCalled,
    sessionsCalled,
    resumeCalled,
    tuiCalled,
    rewindCalled,
    revertLastCalled,
  };
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
    expect(resumeCalled[0].sessionId).toBe("abc-123");
  });

  it("routes plain invocation to main action", async () => {
    const { program, mainCalled, sessionsCalled, resumeCalled, tuiCalled } = makeTestProgram();
    await program.parseAsync(["node", "myagent"]);
    expect(mainCalled).toEqual(["main"]);
    expect(sessionsCalled).toEqual([]);
    expect(resumeCalled).toEqual([]);
    expect(tuiCalled).toEqual([]);
  });

  it("routes 'tui' subcommand", async () => {
    const { program, tuiCalled } = makeTestProgram();
    await program.parseAsync(["node", "myagent", "tui"]);
    expect(tuiCalled).toHaveLength(1);
  });

  it("routes 'rewind <sessionId> <checkpointId>' subcommand", async () => {
    const { program, rewindCalled } = makeTestProgram();
    await program.parseAsync(["node", "myagent", "rewind", "s1", "cp1"]);
    expect(rewindCalled).toEqual([{ sessionId: "s1", checkpointId: "cp1" }]);
  });

  it("routes 'revert-last <sessionId>' subcommand", async () => {
    const { program, revertLastCalled } = makeTestProgram();
    await program.parseAsync(["node", "myagent", "revert-last", "s1"]);
    expect(revertLastCalled).toEqual(["s1"]);
  });

  it("applies root --cwd after resume subcommand", async () => {
    const { program, resumeCalled } = makeTestProgram();
    await program.parseAsync([
      "node",
      "myagent",
      "resume",
      "abc-123",
      "--cwd",
      "/tmp/project",
    ]);
    expect(resumeCalled).toEqual([
      { sessionId: "abc-123", cwd: "/tmp/project" },
    ]);
  });

  it("applies root --cwd after tui subcommand", async () => {
    const { program, tuiCalled } = makeTestProgram();
    await program.parseAsync([
      "node",
      "myagent",
      "tui",
      "--cwd",
      "/tmp/project",
    ]);
    expect(tuiCalled).toEqual(["/tmp/project"]);
  });
});

describe("rewind/revert command behavior", () => {
  it("revertLast can restore a checkpoint referenced by persisted messages", async () => {
    const base = await tmpBaseDir();
    const ws = await tmpBaseDir();
    const store = openTestStore(base);
    await writeFile(join(ws, "a.txt"), "before");
    const checkpoint = await createCheckpoint(ws, ["a.txt"]);
    await writeFile(join(ws, "a.txt"), "after");

    const session = store.createSession({ workspaceRoot: ws });
    store.appendMessages(session.id, [
      {
        role: "tool_result",
        toolCallId: "tc1",
        toolName: "edit_file",
        content: "ok",
        checkpointId: checkpoint.id,
      },
    ]);

    const result = await revertLast(store.getSession(session.id)!);
    store.appendMessages(session.id, [
      {
        role: "assistant",
        content: `revert-last restored checkpoint ${result.checkpointId}`,
      },
    ]);

    expect(await readFile(join(ws, "a.txt"), "utf-8")).toBe("before");
    expect(store.getSession(session.id)?.messages.at(-1)?.content).toContain(
      checkpoint.id,
    );
  });

  it("restoreCheckpoint can restore an explicit checkpoint id", async () => {
    const ws = await tmpBaseDir();
    await writeFile(join(ws, "a.txt"), "before");
    const checkpoint = await createCheckpoint(ws, ["a.txt"]);
    await writeFile(join(ws, "a.txt"), "after");

    const restored = await restoreCheckpoint(ws, checkpoint.id);

    expect(restored.id).toBe(checkpoint.id);
    expect(await readFile(join(ws, "a.txt"), "utf-8")).toBe("before");
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
