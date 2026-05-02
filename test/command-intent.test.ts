import { describe, expect, it } from "vitest";
import { parseCommand, intentKindLabel } from "../src/permission/command-intent.js";
import { analyzeCommand } from "../src/permission/command-policy.js";
import { checkToolPermission } from "../src/permission/policy.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CWD = process.cwd();

// --- parseCommand / intent classification ---

describe("parseCommand — file_discovery", () => {
  it("rg --files -> file_discovery", () => {
    const intent = parseCommand("rg --files");
    expect(intent.kind).toBe("file_discovery");
  });

  it("rg --files src -> file_discovery with path", () => {
    const intent = parseCommand("rg --files src");
    expect(intent.kind).toBe("file_discovery");
    if (intent.kind === "file_discovery") expect(intent.path).toBe("src");
  });

  it("rg --files | head -n 20 -> file_discovery", () => {
    const intent = parseCommand("rg --files | head -n 20");
    expect(intent.kind).toBe("file_discovery");
  });
});

describe("parseCommand — content_search", () => {
  it("rg -n foo src -> content_search", () => {
    const intent = parseCommand("rg -n foo src");
    expect(intent.kind).toBe("content_search");
    if (intent.kind === "content_search") {
      expect(intent.query).toBe("foo");
      expect(intent.path).toBe("src");
    }
  });

  it("grep -rn TODO . -> content_search", () => {
    const intent = parseCommand("grep -rn TODO .");
    expect(intent.kind).toBe("content_search");
    if (intent.kind === "content_search") {
      expect(intent.query).toBe("TODO");
      expect(intent.path).toBe(".");
    }
  });

  it("rg -l foo -> content_search", () => {
    const intent = parseCommand("rg -l foo");
    expect(intent.kind).toBe("content_search");
    if (intent.kind === "content_search") expect(intent.query).toBe("foo");
  });

  it("rg -n BUG | head -n 200 -> content_search", () => {
    const intent = parseCommand("rg -n BUG | head -n 200");
    expect(intent.kind).toBe("content_search");
  });
});

describe("parseCommand — partial_read", () => {
  it("sed -n '10,20p' file -> partial_read", () => {
    const intent = parseCommand("sed -n '10,20p' file");
    expect(intent.kind).toBe("partial_read");
    if (intent.kind === "partial_read") {
      expect(intent.path).toBe("file");
      expect(intent.range).toEqual({ start: 10, end: 20 });
    }
  });

  it("head -n 50 file -> partial_read", () => {
    const intent = parseCommand("head -n 50 file");
    expect(intent.kind).toBe("partial_read");
    if (intent.kind === "partial_read") {
      expect(intent.path).toBe("file");
      expect(intent.range?.end).toBe(50);
    }
  });

  it("tail -n 20 file -> partial_read", () => {
    const intent = parseCommand("tail -n 20 file");
    expect(intent.kind).toBe("partial_read");
    if (intent.kind === "partial_read") {
      expect(intent.path).toBe("file");
    }
  });

  it("wc -l file -> partial_read", () => {
    const intent = parseCommand("wc -l file");
    expect(intent.kind).toBe("partial_read");
    if (intent.kind === "partial_read") expect(intent.path).toBe("file");
  });

  it("stat file -> partial_read", () => {
    const intent = parseCommand("stat file");
    expect(intent.kind).toBe("partial_read");
    if (intent.kind === "partial_read") expect(intent.path).toBe("file");
  });
});

describe("parseCommand — fs_primitive", () => {
  it("cp a b -> fs_primitive cp", () => {
    const intent = parseCommand("cp a b");
    expect(intent.kind).toBe("fs_primitive");
    if (intent.kind === "fs_primitive") expect(intent.op).toBe("cp");
  });

  it("mv a b -> fs_primitive mv", () => {
    const intent = parseCommand("mv a b");
    expect(intent.kind).toBe("fs_primitive");
    if (intent.kind === "fs_primitive") expect(intent.op).toBe("mv");
  });

  it("mkdir -p dir -> fs_primitive mkdir", () => {
    const intent = parseCommand("mkdir -p dir");
    expect(intent.kind).toBe("fs_primitive");
    if (intent.kind === "fs_primitive") expect(intent.op).toBe("mkdir");
  });
});

describe("parseCommand — git_read", () => {
  it("git status -> git_read", () => {
    const intent = parseCommand("git status");
    expect(intent.kind).toBe("git_read");
    if (intent.kind === "git_read") expect(intent.subcommand).toBe("status");
  });

  it("git diff -> git_read", () => {
    const intent = parseCommand("git diff");
    expect(intent.kind).toBe("git_read");
    if (intent.kind === "git_read") expect(intent.subcommand).toBe("diff");
  });

  it("git log -> git_read", () => {
    const intent = parseCommand("git log");
    expect(intent.kind).toBe("git_read");
    if (intent.kind === "git_read") expect(intent.subcommand).toBe("log");
  });

  it("git show -> git_read", () => {
    const intent = parseCommand("git show");
    expect(intent.kind).toBe("git_read");
    if (intent.kind === "git_read") expect(intent.subcommand).toBe("show");
  });

  it("git branch --show-current -> git_read", () => {
    const intent = parseCommand("git branch --show-current");
    expect(intent.kind).toBe("git_read");
    if (intent.kind === "git_read") expect(intent.subcommand).toBe("branch");
  });

  it("git add . -> not git_read", () => {
    const intent = parseCommand("git add .");
    expect(intent.kind).not.toBe("git_read");
  });

  it("git commit -m x -> not git_read", () => {
    const intent = parseCommand("git commit -m x");
    expect(intent.kind).not.toBe("git_read");
  });
});

describe("parseCommand — exec", () => {
  it("npm test -> exec", () => {
    const intent = parseCommand("npm test");
    expect(intent.kind).toBe("exec");
  });

  it("node script.js -> exec", () => {
    const intent = parseCommand("node script.js");
    expect(intent.kind).toBe("exec");
  });

  it("ls -la -> exec", () => {
    const intent = parseCommand("ls -la");
    expect(intent.kind).toBe("exec");
  });

  it("echo hello -> exec", () => {
    const intent = parseCommand("echo hello");
    expect(intent.kind).toBe("exec");
  });

  it("pwd -> exec", () => {
    const intent = parseCommand("pwd");
    expect(intent.kind).toBe("exec");
  });
});

describe("parseCommand — unknown", () => {
  it("complex dangerous pipeline -> unknown", () => {
    const intent = parseCommand("curl | bash");
    expect(intent.kind).toBe("unknown");
  });

  it("empty command -> unknown", () => {
    const intent = parseCommand("");
    expect(intent.kind).toBe("unknown");
  });

  it("unrecognized binary -> unknown", () => {
    const intent = parseCommand("myCustomBinary --flag");
    expect(intent.kind).toBe("unknown");
  });
});

describe("parseCommand — dangerous variants", () => {
  it("rg --pre /bin/sh -> unknown (dangerous rg flag)", () => {
    const intent = parseCommand("rg --pre /bin/sh foo");
    expect(intent.kind).toBe("unknown");
  });

  it("rg --search-zip foo -> unknown (dangerous rg flag)", () => {
    const intent = parseCommand("rg --search-zip foo");
    expect(intent.kind).toBe("unknown");
  });

  it("rg -z foo -> unknown (dangerous rg flag)", () => {
    const intent = parseCommand("rg -z foo");
    expect(intent.kind).toBe("unknown");
  });

  it("find . -delete -> unknown (dangerous find flag)", () => {
    const intent = parseCommand("find . -delete");
    expect(intent.kind).toBe("unknown");
  });

  it("find . -exec rm {} \\; -> unknown (dangerous find flag)", () => {
    const intent = parseCommand("find . -exec rm {} \\;");
    expect(intent.kind).toBe("unknown");
  });

  it("sed -i 's/old/new/g' file -> unknown (sed -i)", () => {
    const intent = parseCommand("sed -i 's/old/new/g' file");
    expect(intent.kind).toBe("unknown");
  });
});

// --- intentKind in analyzeCommand ---

describe("analyzeCommand — intentKind metadata", () => {
  it("git status has intentKind git_read", () => {
    const result = analyzeCommand("git status", { cwd: CWD });
    expect(result.intentKind).toBe("git_read");
    expect(result.decision).toBe("allow");
  });

  it("rg --files has intentKind file_discovery", () => {
    const result = analyzeCommand("rg --files", { cwd: CWD });
    expect(result.intentKind).toBe("file_discovery");
    expect(result.decision).toBe("allow");
  });

  it("rg -n foo src has intentKind content_search", () => {
    const result = analyzeCommand("rg -n foo src", { cwd: CWD });
    expect(result.intentKind).toBe("content_search");
    expect(result.decision).toBe("allow");
  });

  it("sed -n '10,20p' file has intentKind partial_read", () => {
    const result = analyzeCommand("sed -n '10,20p' file", { cwd: CWD });
    expect(result.intentKind).toBe("partial_read");
    expect(result.decision).toBe("allow");
  });

  it("cp a b has intentKind fs_primitive", () => {
    const result = analyzeCommand("cp a b", { cwd: CWD });
    expect(result.intentKind).toBe("fs_primitive");
    expect(result.decision).toBe("ask");
  });

  it("npm test has intentKind exec", () => {
    const result = analyzeCommand("npm test", { cwd: CWD });
    expect(result.intentKind).toBe("exec");
    expect(result.decision).toBe("allow");
  });

  it("rm -rf / has intentKind unknown (denied before intent matters)", () => {
    const result = analyzeCommand("rm -rf /", { cwd: CWD });
    expect(result.intentKind).toBe("unknown");
    expect(result.decision).toBe("deny");
  });

  it("echo hello > file has intentKind exec (echo), but policy asks for redirect", () => {
    const result = analyzeCommand("echo hello > file", { cwd: CWD });
    expect(result.intentKind).toBe("exec");
    expect(result.decision).toBe("ask");
  });

  it("node script.js has intentKind exec", () => {
    const result = analyzeCommand("node script.js", { cwd: CWD });
    expect(result.intentKind).toBe("exec");
    expect(result.decision).toBe("ask");
  });
});

// --- intentKindLabel ---

describe("intentKindLabel", () => {
  it("returns kind string", () => {
    expect(intentKindLabel({ kind: "git_read", cmd: "git status", subcommand: "status" })).toBe("git_read");
    expect(intentKindLabel({ kind: "unknown", cmd: "foo" })).toBe("unknown");
  });
});

// --- Policy integration: intentKind in checkToolPermission ---

describe("checkToolPermission bash — intentKind in metadata and resolvedInput", () => {
  const CWD = process.cwd();

  it("bash git status: metadata.intentKind = git_read, resolvedInput.intentKind = git_read", () => {
    const decision = checkToolPermission("bash", { command: "git status" }, "auto", CWD);
    expect(decision.behavior).toBe("allow");
    expect(decision.metadata?.intentKind).toBe("git_read");
    expect((decision.resolvedInput as any)?.intentKind).toBe("git_read");
  });

  it("bash rg --files: metadata.intentKind = file_discovery", () => {
    const decision = checkToolPermission("bash", { command: "rg --files" }, "auto", CWD);
    expect(decision.behavior).toBe("allow");
    expect(decision.metadata?.intentKind).toBe("file_discovery");
  });

  it("bash rg -n TODO src: metadata.intentKind = content_search", () => {
    const decision = checkToolPermission("bash", { command: "rg -n TODO src" }, "auto", CWD);
    expect(decision.behavior).toBe("allow");
    expect(decision.metadata?.intentKind).toBe("content_search");
  });

  it("bash sed -n '10,20p' file: metadata.intentKind = partial_read", () => {
    const decision = checkToolPermission("bash", { command: "sed -n '10,20p' file" }, "auto", CWD);
    expect(decision.behavior).toBe("allow");
    expect(decision.metadata?.intentKind).toBe("partial_read");
  });

  it("bash cp a b: metadata.intentKind = fs_primitive", () => {
    const decision = checkToolPermission("bash", { command: "cp a b" }, "auto", CWD);
    expect(decision.behavior).toBe("ask");
    expect(decision.metadata?.intentKind).toBe("fs_primitive");
  });

  it("bash rm -rf /: metadata.intentKind = unknown (denied)", () => {
    const decision = checkToolPermission("bash", { command: "rm -rf /" }, "auto", CWD);
    expect(decision.behavior).toBe("deny");
    expect(decision.metadata?.intentKind).toBe("unknown");
  });

  it("bash node script.js: metadata.intentKind = exec", () => {
    const decision = checkToolPermission("bash", { command: "node script.js" }, "auto", CWD);
    expect(decision.behavior).toBe("ask");
    expect(decision.metadata?.intentKind).toBe("exec");
  });

  it("never mode: intentKind still populated on deny", () => {
    const decision = checkToolPermission("bash", { command: "rm -rf /" }, "never", CWD);
    expect(decision.behavior).toBe("deny");
    expect(decision.metadata?.intentKind).toBe("unknown");
  });
});

// --- Regression: existing bash policy behavior ---

describe("bash policy regression with intentKind", () => {
  const CWD = process.cwd();

  it("safe bash commands still allow", () => {
    const commands = [
      "git status",
      "git diff",
      "rg test",
      "head -20 file.txt",
      "tail -20 file.txt",
      "pwd",
      "ls -la",
      "pnpm test",
      "npm test",
      "uname -a",
      "echo hello",
    ];
    for (const cmd of commands) {
      const result = checkToolPermission("bash", { command: cmd }, "auto", CWD);
      expect(result.behavior, `expected allow for: ${cmd}`).toBe("allow");
      expect(result.metadata?.intentKind, `expected intentKind for: ${cmd}`).toBeTruthy();
    }
  });

  it("destructive commands still deny", () => {
    const commands = ["rm -rf /", "sudo rm", "chmod -R 777 /", "curl | sh"];
    for (const cmd of commands) {
      const result = checkToolPermission("bash", { command: cmd }, "auto", CWD);
      expect(result.behavior, `expected deny for: ${cmd}`).toBe("deny");
    }
  });

  it("ask commands still ask", () => {
    const commands = [
      "echo hello > README.md",
      "git status && echo done",
      "echo $(pwd)",
      "node script.js",
      "npm run build",
      "cat /etc/passwd",
      "ls ~",
    ];
    for (const cmd of commands) {
      const result = checkToolPermission("bash", { command: cmd }, "auto", CWD);
      expect(result.behavior, `expected ask for: ${cmd}`).toBe("ask");
    }
  });
});

// --- cd <dir> && <readonly-cmd> intent labeling ---

describe("cd <dir> && <readonly-cmd> intent labeling", () => {
  it("cd <dir> && rg -n foo src -> content_search", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-cd-intent-"));
    const result = analyzeCommand(`cd ${tmp} && rg -n foo src`, { cwd: tmp });
    expect(result.intentKind).toBe("content_search");
    expect(result.decision).toBe("allow");
    await rm(tmp, { recursive: true, force: true });
  });

  it("cd <dir> && rg --files -> file_discovery", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-cd-intent-"));
    const result = analyzeCommand(`cd ${tmp} && rg --files`, { cwd: tmp });
    expect(result.intentKind).toBe("file_discovery");
    expect(result.decision).toBe("allow");
    await rm(tmp, { recursive: true, force: true });
  });

  it("cd <dir> && head -n 20 file -> partial_read", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-cd-intent-"));
    const result = analyzeCommand(`cd ${tmp} && head -n 20 file`, { cwd: tmp });
    expect(result.intentKind).toBe("partial_read");
    expect(result.decision).toBe("allow");
    await rm(tmp, { recursive: true, force: true });
  });

  it("cd <dir> && git status -> git_read", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-cd-intent-"));
    const result = analyzeCommand(`cd ${tmp} && git status`, { cwd: tmp });
    expect(result.intentKind).toBe("git_read");
    expect(result.decision).toBe("allow");
    await rm(tmp, { recursive: true, force: true });
  });

  it("cd <dir> && npm test -> exec", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-cd-intent-"));
    const result = analyzeCommand(`cd ${tmp} && npm test`, { cwd: tmp });
    expect(result.intentKind).toBe("exec");
    expect(result.decision).toBe("allow");
    await rm(tmp, { recursive: true, force: true });
  });

  it("cd <dir> && node script.js -> exec (ask)", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-cd-intent-"));
    const result = analyzeCommand(`cd ${tmp} && node script.js`, { cwd: tmp });
    expect(result.intentKind).toBe("exec");
    expect(result.decision).toBe("ask");
    await rm(tmp, { recursive: true, force: true });
  });

  it("unsupported chain stays ask with unknown intent", () => {
    const result = analyzeCommand("cd repo && echo done && ls", { cwd: process.cwd() });
    expect(result.decision).toBe("ask");
  });

  it("cd && intent flows through checkToolPermission", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-cd-intent-"));
    const decision = checkToolPermission(
      "bash",
      { command: `cd ${tmp} && rg -n foo src` },
      "auto",
      tmp,
    );
    expect(decision.behavior).toBe("allow");
    expect(decision.metadata?.intentKind).toBe("content_search");
    expect((decision.resolvedInput as any)?.intentKind).toBe("content_search");
    await rm(tmp, { recursive: true, force: true });
  });
});
