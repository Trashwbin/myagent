import { describe, it, expect } from "vitest";
import { checkPermission } from "../src/permission/rules.js";

const CWD = process.cwd();

describe("Permission rules", () => {
  it("allows read_file", () => {
    const result = checkPermission("read_file", { path: "a.txt" }, "auto", CWD);
    expect(result.behavior).toBe("allow");
  });

  it("allows search", () => {
    const result = checkPermission("search", { pattern: "test" }, "auto", CWD);
    expect(result.behavior).toBe("allow");
  });

  it("asks for edit_file in auto mode", () => {
    const result = checkPermission(
      "edit_file",
      { path: "a.txt", old_string: "x", new_string: "y" },
      "auto",
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

  it("asks for edit_file in on-request mode", () => {
    const result = checkPermission(
      "edit_file",
      { path: "a.txt", old_string: "x", new_string: "y" },
      "on-request",
      CWD,
    );
    expect(result.behavior).toBe("ask");
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
});
