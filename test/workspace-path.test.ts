import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readFileTool } from "../src/tools/read.js";
import { editFileTool } from "../src/tools/edit.js";
import { createCheckpoint } from "../src/workspace/checkpoint.js";
import { runTurn } from "../src/session/loop.js";
import { FakeProvider } from "../src/model/fake.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { checkPermission } from "../src/permission/rules.js";
import type { SessionState } from "../src/session/loop.js";

function makeSession(cwd: string): SessionState {
  return { id: randomUUID(), cwd, messages: [] };
}

// --- read_file: outside workspace requires approval ---

describe("read_file outside workspace", () => {
  it("asks for sibling file; no approvalHandler → not executed", async () => {
    const root = await mkdtemp(join(tmpdir(), "myagent-workspace-"));
    const sibling = `${root}-sibling`;
    await mkdir(sibling);
    await writeFile(join(sibling, "secret.txt"), "sibling content");

    const provider = new FakeProvider([
      [
        {
          type: "tool-call",
          id: "tc1",
          name: "Read",
          input: { path: `../${sibling.split("/").at(-1)}/secret.txt` },
        },
        { type: "finish", reason: "tool-calls" },
      ],
      [
        { type: "text", delta: "done" },
        { type: "finish", reason: "stop" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const { newMessages } = await runTurn(provider, registry, makeSession(root), "read", {
      approval: "auto",
    });

    // Tool was not executed (no approvalHandler)
    const toolResult = newMessages.find((m) => m.role === "tool_result");
    expect(toolResult).toBeDefined();
    expect(toolResult!.content).toContain("requires approval");

    // File was NOT read
    expect(newMessages.some((m) => m.content?.includes("sibling content"))).toBe(false);

    await rm(root, { recursive: true, force: true });
    await rm(sibling, { recursive: true, force: true });
  });

  it("approval allow → reads the file", async () => {
    const root = await mkdtemp(join(tmpdir(), "myagent-workspace-"));
    const sibling = `${root}-sibling`;
    await mkdir(sibling);
    await writeFile(join(sibling, "data.txt"), "sibling data");

    const provider = new FakeProvider([
      [
        {
          type: "tool-call",
          id: "tc1",
          name: "Read",
          input: { path: `../${sibling.split("/").at(-1)}/data.txt` },
        },
        { type: "finish", reason: "tool-calls" },
      ],
      [
        { type: "text", delta: "done" },
        { type: "finish", reason: "stop" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const { newMessages } = await runTurn(provider, registry, makeSession(root), "read", {
      approval: "auto",
      approvalHandler: async () => "allow_once",
    });

    const toolResult = newMessages.find((m) => m.role === "tool_result");
    expect(toolResult).toBeDefined();
    expect(toolResult!.content).toContain("sibling data");

    await rm(root, { recursive: true, force: true });
    await rm(sibling, { recursive: true, force: true });
  });

  it("approval deny → does not read the file", async () => {
    const root = await mkdtemp(join(tmpdir(), "myagent-workspace-"));
    const sibling = `${root}-sibling`;
    await mkdir(sibling);
    await writeFile(join(sibling, "data.txt"), "secret data");

    const provider = new FakeProvider([
      [
        {
          type: "tool-call",
          id: "tc1",
          name: "Read",
          input: { path: `../${sibling.split("/").at(-1)}/data.txt` },
        },
        { type: "finish", reason: "tool-calls" },
      ],
      [
        { type: "text", delta: "done" },
        { type: "finish", reason: "stop" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const { newMessages } = await runTurn(provider, registry, makeSession(root), "read", {
      approval: "auto",
      approvalHandler: async () => "abort",
    });

    const toolResult = newMessages.find((m) => m.role === "tool_result");
    expect(toolResult).toBeDefined();
    expect(toolResult!.content).toContain("denied");
    expect(newMessages.some((m) => m.content?.includes("secret data"))).toBe(false);

    await rm(root, { recursive: true, force: true });
    await rm(sibling, { recursive: true, force: true });
  });

  it("symlink pointing outside → ask, not allow", async () => {
    const root = await mkdtemp(join(tmpdir(), "myagent-workspace-"));
    const outside = await mkdtemp(join(tmpdir(), "myagent-outside-"));
    await writeFile(join(outside, "secret.txt"), "secret");
    await symlink(outside, join(root, "outside"));

    const provider = new FakeProvider([
      [
        {
          type: "tool-call",
          id: "tc1",
          name: "Read",
          input: { path: "outside/secret.txt" },
        },
        { type: "finish", reason: "tool-calls" },
      ],
      [
        { type: "text", delta: "done" },
        { type: "finish", reason: "stop" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(readFileTool);

    // No approvalHandler — should be blocked (ask, not allow)
    const { newMessages } = await runTurn(provider, registry, makeSession(root), "read", {
      approval: "auto",
    });

    const toolResult = newMessages.find((m) => m.role === "tool_result");
    expect(toolResult).toBeDefined();
    expect(toolResult!.content).toContain("requires approval");

    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("sensitive .env file → ask even inside workspace; approval allow → reads", async () => {
    const root = await mkdtemp(join(tmpdir(), "myagent-workspace-"));
    await writeFile(join(root, ".env"), "SECRET=abc");

    const provider = new FakeProvider([
      [
        {
          type: "tool-call",
          id: "tc1",
          name: "Read",
          input: { path: ".env" },
        },
        { type: "finish", reason: "tool-calls" },
      ],
      [
        { type: "text", delta: "done" },
        { type: "finish", reason: "stop" },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const { newMessages } = await runTurn(
      provider,
      registry,
      makeSession(root),
      "read env",
      {
        approval: "auto",
        approvalHandler: async () => "allow_once",
      },
    );

    const toolResult = newMessages.find((m) => m.role === "tool_result");
    expect(toolResult).toBeDefined();
    expect(toolResult!.content).toContain("SECRET=abc");

    await rm(root, { recursive: true, force: true });
  });
});

// --- tool guard: direct tool call without resolvedPath ---

describe("read_file tool guard", () => {
  it("rejects external path when called directly without resolvedPath", async () => {
    const root = await mkdtemp(join(tmpdir(), "myagent-workspace-"));
    const sibling = `${root}-sibling`;
    await mkdir(sibling);
    await writeFile(join(sibling, "secret.txt"), "secret");

    const result = await readFileTool.execute(
      { path: `../${sibling.split("/").at(-1)}/secret.txt` },
      { cwd: root },
    );

    expect(result.ok).toBe(false);
    expect(result.output).toContain("permission-resolved input");

    await rm(root, { recursive: true, force: true });
    await rm(sibling, { recursive: true, force: true });
  });

  it("does not trust caller-supplied resolvedPath without permission context", async () => {
    const root = await mkdtemp(join(tmpdir(), "myagent-workspace-"));
    const sibling = `${root}-sibling`;
    await mkdir(sibling);
    const target = join(sibling, "secret.txt");
    await writeFile(target, "secret");

    const result = await readFileTool.execute(
      {
        path: `../${sibling.split("/").at(-1)}/secret.txt`,
        resolvedPath: target,
      },
      { cwd: root },
    );

    expect(result.ok).toBe(false);
    expect(result.output).toContain("permission-resolved input");

    await rm(root, { recursive: true, force: true });
    await rm(sibling, { recursive: true, force: true });
  });

  it("allows workspace file when called directly without resolvedPath", async () => {
    const root = await mkdtemp(join(tmpdir(), "myagent-workspace-"));
    await writeFile(join(root, "file.txt"), "content");

    const result = await readFileTool.execute({ path: "file.txt" }, { cwd: root });

    expect(result.ok).toBe(true);
    expect(result.output).toBe("1: content");

    await rm(root, { recursive: true, force: true });
  });
});

// --- search: sensitive file exclusion ---

describe("search sensitive file exclusion", () => {
  it("excludes .env files from search results", async () => {
    const root = await mkdtemp(join(tmpdir(), "myagent-workspace-"));
    await writeFile(join(root, "todo.md"), "TODO: fix SECRET_TOKEN");
    await writeFile(join(root, ".env"), "SECRET_TOKEN=abc");

    const { searchTool } = await import("../src/tools/search.js");
    const result = await searchTool.execute({ pattern: "SECRET_TOKEN" }, { cwd: root });

    expect(result.ok).toBe(true);
    expect(result.output).toContain("todo.md");
    expect(result.output).not.toContain(".env");

    await rm(root, { recursive: true, force: true });
  });

  it("does not trust caller-supplied excludeSensitive without permission context", async () => {
    const root = await mkdtemp(join(tmpdir(), "myagent-workspace-"));
    await writeFile(join(root, "todo.md"), "TODO: fix SECRET_TOKEN");
    await writeFile(join(root, ".env"), "SECRET_TOKEN=abc");

    const { searchTool } = await import("../src/tools/search.js");
    const result = await searchTool.execute(
      { pattern: "SECRET_TOKEN", path: ".", excludeSensitive: false },
      { cwd: root },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("todo.md");
    expect(result.output).not.toContain(".env");

    await rm(root, { recursive: true, force: true });
  });

  it("does not trust caller-supplied search resolvedPath without permission context", async () => {
    const root = await mkdtemp(join(tmpdir(), "myagent-workspace-"));
    const sibling = `${root}-sibling`;
    await mkdir(sibling);
    await writeFile(join(sibling, "secret.txt"), "needle");

    const { searchTool } = await import("../src/tools/search.js");
    const result = await searchTool.execute(
      {
        pattern: "needle",
        path: `../${sibling.split("/").at(-1)}`,
        resolvedPath: sibling,
      },
      { cwd: root },
    );

    expect(result.ok).toBe(false);
    expect(result.output).toContain("permission-resolved input");

    await rm(root, { recursive: true, force: true });
    await rm(sibling, { recursive: true, force: true });
  });

  it("excludes dependency/build directories from search results", async () => {
    const root = await mkdtemp(join(tmpdir(), "myagent-workspace-"));
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, "src", "app.ts"), "needle in source");
    await writeFile(join(root, "node_modules", "pkg", "index.js"), "needle in deps");

    const { searchTool } = await import("../src/tools/search.js");
    const result = await searchTool.execute(
      { pattern: "needle", path: "." },
      { cwd: root },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("src");
    expect(result.output).not.toContain("node_modules");

    await rm(root, { recursive: true, force: true });
  });

  it("supports caller-provided search excludes", async () => {
    const root = await mkdtemp(join(tmpdir(), "myagent-workspace-"));
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "vendor"), { recursive: true });
    await writeFile(join(root, "src", "app.ts"), "needle in source");
    await writeFile(join(root, "vendor", "generated.ts"), "needle in vendor");

    const { searchTool } = await import("../src/tools/search.js");
    const result = await searchTool.execute(
      { pattern: "needle", path: ".", exclude: ["vendor"] },
      { cwd: root },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("src");
    expect(result.output).not.toContain("vendor");

    await rm(root, { recursive: true, force: true });
  });

  it("truncates broad search results instead of failing maxBuffer", async () => {
    const root = await mkdtemp(join(tmpdir(), "myagent-workspace-"));
    const lines = Array.from({ length: 260 }, (_, i) => `needle line ${i}`).join("\n");
    await writeFile(join(root, "large.txt"), lines);

    const { searchTool } = await import("../src/tools/search.js");
    const result = await searchTool.execute(
      { pattern: "needle", path: "." },
      { cwd: root },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("needle line 0");
    expect(result.output).toContain("search results truncated");

    await rm(root, { recursive: true, force: true });
  });

  it("honors caller-provided max_results", async () => {
    const root = await mkdtemp(join(tmpdir(), "myagent-workspace-"));
    const lines = Array.from({ length: 10 }, (_, i) => `needle line ${i}`).join("\n");
    await writeFile(join(root, "limited.txt"), lines);

    const { searchTool } = await import("../src/tools/search.js");
    const result = await searchTool.execute(
      { pattern: "needle", path: ".", max_results: 3 },
      { cwd: root },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("needle line 0");
    expect(result.output).not.toContain("needle line 9");
    expect(result.output).toContain("search results truncated");

    await rm(root, { recursive: true, force: true });
  });

  it("grep outside workspace → ask", async () => {
    const result = checkPermission(
      "grep",
      { pattern: "test", path: "/etc" },
      "auto",
      process.cwd(),
    );
    expect(result.behavior).toBe("ask");
    expect(result.reason).toContain("outside workspace");
  });

  it("grep inside workspace → allow", async () => {
    const result = checkPermission(
      "grep",
      { pattern: "test", path: "." },
      "auto",
      process.cwd(),
    );
    expect(result.behavior).toBe("allow");
  });
});

// --- edit_file: still restricted to workspace ---

describe("edit_file workspace restriction (unchanged)", () => {
  it("does not edit files outside the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "myagent-workspace-"));
    const sibling = `${root}-sibling`;
    await mkdir(sibling);
    const target = join(sibling, "secret.txt");
    await writeFile(target, "secret");

    const result = await editFileTool.execute(
      {
        path: `../${sibling.split("/").at(-1)}/secret.txt`,
        old_string: "secret",
        new_string: "changed",
      },
      { cwd: root },
    );

    expect(result.ok).toBe(false);
    expect(await readFile(target, "utf-8")).toBe("secret");

    await rm(root, { recursive: true, force: true });
    await rm(sibling, { recursive: true, force: true });
  });

  it("does not trust caller-supplied edit resolvedPath without permission context", async () => {
    const root = await mkdtemp(join(tmpdir(), "myagent-workspace-"));
    const sibling = `${root}-sibling`;
    await mkdir(sibling);
    const target = join(sibling, "secret.txt");
    const workspaceFile = join(root, "workspace.txt");
    await writeFile(target, "secret");
    await writeFile(workspaceFile, "workspace");

    const result = await editFileTool.execute(
      {
        path: "workspace.txt",
        resolvedPath: target,
        old_string: "workspace",
        new_string: "changed",
      },
      { cwd: root },
    );

    expect(result.ok).toBe(true);
    expect(await readFile(workspaceFile, "utf-8")).toBe("changed");
    expect(await readFile(target, "utf-8")).toBe("secret");

    await rm(root, { recursive: true, force: true });
    await rm(sibling, { recursive: true, force: true });
  });

  it("does not edit through symlinks that point outside the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "myagent-workspace-"));
    const outside = await mkdtemp(join(tmpdir(), "myagent-outside-"));
    const target = join(outside, "secret.txt");
    await writeFile(target, "secret");
    await symlink(outside, join(root, "outside"));

    const result = await editFileTool.execute(
      {
        path: "outside/secret.txt",
        old_string: "secret",
        new_string: "changed",
      },
      { cwd: root },
    );

    expect(result.ok).toBe(false);
    expect(await readFile(target, "utf-8")).toBe("secret");

    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
});

// --- checkpoint: still restricted to workspace ---

describe("checkpoint workspace restriction (unchanged)", () => {
  it("does not checkpoint new files through symlinked outside directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "myagent-workspace-"));
    const outside = await mkdtemp(join(tmpdir(), "myagent-outside-"));
    await symlink(outside, join(root, "outside"));

    await expect(createCheckpoint(root, ["outside/new.txt"])).rejects.toThrow(
      "outside workspace",
    );

    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
});
