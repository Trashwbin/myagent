import { describe, expect, it } from "vitest";
import {
  buildApprovalPattern,
  matchesApprovalRule,
  createSessionRule,
} from "../src/permission/approval.js";
import type { ToolPermissionDecision } from "../src/permission/policy.js";

function makeDecision(
  overrides: Partial<ToolPermissionDecision> = {},
): ToolPermissionDecision {
  return {
    behavior: "ask",
    reason: "test",
    metadata: {},
    ...overrides,
  };
}

describe("buildApprovalPattern", () => {
  it("uses command for bash", () => {
    const decision = makeDecision();
    const pattern = buildApprovalPattern("bash", { command: "ls -la" }, decision);
    expect(pattern).toBe("ls -la");
  });

  it("uses realPath from metadata for Read", () => {
    const decision = makeDecision({
      metadata: { realPath: "/project/.env", absolutePath: "/project/.env" },
    });
    const pattern = buildApprovalPattern("Read", { path: ".env" }, decision);
    expect(pattern).toBe("/project/.env");
  });

  it("falls back to input path for Read when no metadata", () => {
    const decision = makeDecision({ metadata: undefined });
    const pattern = buildApprovalPattern("Read", { path: ".env" }, decision);
    expect(pattern).toBe(".env");
  });

  it("uses realPath from metadata for grep", () => {
    const decision = makeDecision({
      metadata: { realPath: "/project/src", absolutePath: "/project/src" },
    });
    const pattern = buildApprovalPattern(
      "grep",
      { pattern: "TODO", path: "src" },
      decision,
    );
    expect(pattern).toBe("/project/src");
  });

  it("uses realPath from metadata for glob", () => {
    const decision = makeDecision({
      metadata: { realPath: "/project/src", absolutePath: "/project/src" },
    });
    const pattern = buildApprovalPattern(
      "glob",
      { pattern: "*.ts", path: "src" },
      decision,
    );
    expect(pattern).toBe("/project/src");
  });

  it("uses realPath from metadata for list_dir", () => {
    const decision = makeDecision({
      metadata: { realPath: "/project/.ssh", absolutePath: "/project/.ssh" },
    });
    const pattern = buildApprovalPattern("list_dir", { path: ".ssh" }, decision);
    expect(pattern).toBe("/project/.ssh");
  });

  it("uses absolutePath from metadata for edit_file", () => {
    const decision = makeDecision({
      metadata: { absolutePath: "/project/file.ts", realPath: "/project/file.ts" },
    });
    const pattern = buildApprovalPattern(
      "edit_file",
      { path: "file.ts", old_string: "a", new_string: "b" },
      decision,
    );
    expect(pattern).toBe("/project/file.ts");
  });

  it("returns undefined for unknown tool", () => {
    const decision = makeDecision();
    const pattern = buildApprovalPattern("unknown_tool", {}, decision);
    expect(pattern).toBeUndefined();
  });
});

describe("matchesApprovalRule", () => {
  it("matches when toolName and pattern match", () => {
    const decision = makeDecision({
      metadata: { realPath: "/project/.env" },
    });
    const result = matchesApprovalRule("Read", { path: ".env" }, decision, {
      toolName: "Read",
      pattern: "/project/.env",
    });
    expect(result).toBe(true);
  });

  it("does not match when toolName differs", () => {
    const decision = makeDecision({
      metadata: { realPath: "/project/.env" },
    });
    const result = matchesApprovalRule(
      "grep",
      { pattern: "x", path: ".env" },
      decision,
      {
        toolName: "Read",
        pattern: "/project/.env",
      },
    );
    expect(result).toBe(false);
  });

  it("does not match when pattern differs", () => {
    const decision = makeDecision({
      metadata: { realPath: "/project/.env" },
    });
    const result = matchesApprovalRule("Read", { path: ".env" }, decision, {
      toolName: "Read",
      pattern: "/other/.env",
    });
    expect(result).toBe(false);
  });

  it("matches bash by exact command", () => {
    const decision = makeDecision();
    const result = matchesApprovalRule("bash", { command: "npm test" }, decision, {
      toolName: "bash",
      pattern: "npm test",
    });
    expect(result).toBe(true);
  });

  it("does not match similar but different bash command", () => {
    const decision = makeDecision();
    const result = matchesApprovalRule("bash", { command: "npm run test" }, decision, {
      toolName: "bash",
      pattern: "npm test",
    });
    expect(result).toBe(false);
  });
});

describe("createSessionRule", () => {
  it("creates a session-scoped rule", () => {
    const rule = createSessionRule("bash", "npm test", "/project", "test reason");
    expect(rule.toolName).toBe("bash");
    expect(rule.pattern).toBe("npm test");
    expect(rule.workspaceRoot).toBe("/project");
    expect(rule.scope).toBe("session");
    expect(rule.action).toBe("allow");
    expect(rule.id).toBeTruthy();
    expect(rule.createdAt).toBeGreaterThan(0);
  });
});

describe("matchesApprovalRule with external_directory", () => {
  it("matches Read under approved external directory", () => {
    const decision = makeDecision({
      metadata: { realPath: "/ext/project/package.json", sensitive: false },
    });
    const result = matchesApprovalRule(
      "Read",
      { path: "/ext/project/package.json" },
      decision,
      { toolName: "external_directory", pattern: "/ext/project/*" },
    );
    expect(result).toBe(true);
  });

  it("matches grep under approved external directory", () => {
    const decision = makeDecision({
      metadata: { realPath: "/ext/project/src", sensitive: false },
    });
    const result = matchesApprovalRule(
      "grep",
      { pattern: "TODO", path: "/ext/project/src" },
      decision,
      { toolName: "external_directory", pattern: "/ext/project/*" },
    );
    expect(result).toBe(true);
  });

  it("does not match path outside approved directory", () => {
    const decision = makeDecision({
      metadata: { realPath: "/ext/other/file.txt", sensitive: false },
    });
    const result = matchesApprovalRule(
      "Read",
      { path: "/ext/other/file.txt" },
      decision,
      { toolName: "external_directory", pattern: "/ext/project/*" },
    );
    expect(result).toBe(false);
  });

  it("does not match sensitive file even in approved directory", () => {
    const decision = makeDecision({
      metadata: { realPath: "/ext/project/.env", sensitive: true },
    });
    const result = matchesApprovalRule(
      "Read",
      { path: "/ext/project/.env" },
      decision,
      { toolName: "external_directory", pattern: "/ext/project/*" },
    );
    expect(result).toBe(false);
  });

  it("does not match edit_file (not an external dir tool)", () => {
    const decision = makeDecision({
      metadata: { realPath: "/ext/project/file.txt", sensitive: false },
    });
    const result = matchesApprovalRule(
      "edit_file",
      { path: "/ext/project/file.txt" },
      decision,
      { toolName: "external_directory", pattern: "/ext/project/*" },
    );
    expect(result).toBe(false);
  });

  it("matches bash readonly command under approved external directory", () => {
    const decision = makeDecision({
      metadata: {
        effect: "read",
        effectiveCwd: "/ext/project",
        externalDirectoryRoot: "/ext/project",
        sensitive: false,
      },
    });
    const result = matchesApprovalRule("bash", { command: "git diff" }, decision, {
      toolName: "external_directory",
      pattern: "/ext/project/*",
    });
    expect(result).toBe(true);
  });

  it("does not match bash write command under external directory", () => {
    const decision = makeDecision({
      metadata: { effect: "write", sensitive: false },
    });
    const result = matchesApprovalRule("bash", { command: "git add ." }, decision, {
      toolName: "external_directory",
      pattern: "/ext/project/*",
    });
    expect(result).toBe(false);
  });

  it("does not match bash dangerous command under external directory", () => {
    const decision = makeDecision({
      metadata: { effect: "dangerous" },
    });
    const result = matchesApprovalRule("bash", { command: "rm -rf /" }, decision, {
      toolName: "external_directory",
      pattern: "/ext/project/*",
    });
    expect(result).toBe(false);
  });

  it("bash uses approvalPattern from metadata over full command", () => {
    const decision = makeDecision({
      metadata: { approvalPattern: "git diff *" },
    });
    const pattern = buildApprovalPattern(
      "bash",
      { command: "cd ../repo && git diff" },
      decision,
    );
    expect(pattern).toBe("git diff *");
  });

  it("bash falls back to full command when no approvalPattern", () => {
    const decision = makeDecision({ metadata: {} });
    const pattern = buildApprovalPattern("bash", { command: "git diff" }, decision);
    expect(pattern).toBe("git diff");
  });
});
