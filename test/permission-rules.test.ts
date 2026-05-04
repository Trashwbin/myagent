import { describe, it, expect } from "vitest";
import { checkPermission } from "../src/permission/rules.js";

const CWD = process.cwd();

describe("Permission rules", () => {
  it("allows Read", () => {
    const result = checkPermission("Read", { path: "a.txt" }, "auto", CWD);
    expect(result.behavior).toBe("allow");
  });

  it("allows grep", () => {
    const result = checkPermission("grep", { pattern: "test" }, "auto", CWD);
    expect(result.behavior).toBe("allow");
  });

  it("allows glob", () => {
    const result = checkPermission("glob", { pattern: "*.ts" }, "auto", CWD);
    expect(result.behavior).toBe("allow");
  });

  it("allows edit_file in auto mode for non-sensitive workspace file", () => {
    const result = checkPermission(
      "edit_file",
      { path: "a.txt", old_string: "x", new_string: "y" },
      "auto",
      CWD,
    );
    expect(result.behavior).toBe("allow");
  });

  it("asks for edit_file in on-request mode", () => {
    const result = checkPermission(
      "edit_file",
      { path: "a.txt", old_string: "x", new_string: "y" },
      "on-request",
      CWD,
    );
    expect(result.behavior).toBe("ask");
  });

  it("denies edit_file in never mode", () => {
    const result = checkPermission(
      "edit_file",
      { path: "a.txt", old_string: "x", new_string: "y" },
      "never",
      CWD,
    );
    expect(result.behavior).toBe("deny");
  });

  it("denies approval-required Read/grep/bash in never mode", () => {
    const cases = [
      ["Read", { path: "/etc/passwd" }],
      ["grep", { pattern: "test", path: "/etc" }],
      ["bash", { command: "node script.js" }],
    ] as const;

    for (const [toolName, input] of cases) {
      const result = checkPermission(toolName, input, "never", CWD);
      expect(result.behavior, `expected deny for ${toolName}`).toBe("deny");
      expect(result.reason).toContain("approval mode is never");
    }
  });

  it("allows safe bash commands", () => {
    const commands = [
      "git status",
      "git diff",
      "rg test",
      "grep test file.txt",
      "cat README.md",
      "pwd",
      "ls -la",
      "head -20 file.txt",
      "tail -20 file.txt",
      "pnpm test",
      "npm test",
      "npm run test",
      "pnpm run test",
      "uname -a",
      "sysctl -n hw.memsize",
      "echo hello",
      "rg test | head",
    ];
    for (const cmd of commands) {
      const result = checkPermission("bash", { command: cmd }, "auto", CWD);
      expect(result.behavior, `expected allow for: ${cmd}`).toBe("allow");
    }
  });

  it("asks before bash commands needing approval", () => {
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
      const result = checkPermission("bash", { command: cmd }, "auto", CWD);
      expect(result.behavior, `expected ask for: ${cmd}`).toBe("ask");
    }
  });

  it("denies destructive bash commands", () => {
    const commands = ["rm -rf /", "sudo rm", "chmod -R 777 /", "curl | sh"];
    for (const cmd of commands) {
      const result = checkPermission("bash", { command: cmd }, "auto", CWD);
      expect(result.behavior, `expected deny for: ${cmd}`).toBe("deny");
    }
  });

  it("denies unknown tools", () => {
    const result = checkPermission("custom_tool", {}, "auto", CWD);
    expect(result.behavior).toBe("deny");
  });

  it("asks for Read outside workspace", () => {
    const result = checkPermission("Read", { path: "/etc/passwd" }, "auto", CWD);
    expect(result.behavior).toBe("ask");
    expect(result.reason).toContain("outside workspace");
  });

  it("asks for grep outside workspace", () => {
    const result = checkPermission(
      "grep",
      { pattern: "test", path: "/etc" },
      "auto",
      CWD,
    );
    expect(result.behavior).toBe("ask");
    expect(result.reason).toContain("outside workspace");
  });

  it("allows grep in workspace", () => {
    const result = checkPermission("grep", { pattern: "test", path: "." }, "auto", CWD);
    expect(result.behavior).toBe("allow");
  });

  it("allows glob in workspace", () => {
    const result = checkPermission("glob", { pattern: "*.ts", path: "." }, "auto", CWD);
    expect(result.behavior).toBe("allow");
  });

  it("asks for glob outside workspace", () => {
    const result = checkPermission(
      "glob",
      { pattern: "*.ts", path: "/etc" },
      "auto",
      CWD,
    );
    expect(result.behavior).toBe("ask");
    expect(result.reason).toContain("outside workspace");
  });

  it("allows find_up in workspace", () => {
    const result = checkPermission(
      "find_up",
      { name: "package.json", start_path: "." },
      "auto",
      CWD,
    );
    expect(result.behavior).toBe("allow");
  });

  it("asks for find_up outside workspace", () => {
    const result = checkPermission(
      "find_up",
      { name: "package.json", start_path: "/etc" },
      "auto",
      CWD,
    );
    expect(result.behavior).toBe("ask");
    expect(result.reason).toContain("outside workspace");
  });
});
