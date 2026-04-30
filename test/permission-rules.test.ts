import { describe, it, expect } from "vitest";
import { checkPermission } from "../src/permission/rules.js";

describe("Permission rules", () => {
  it("allows read_file", () => {
    const result = checkPermission("read_file", { path: "a.txt" }, "auto");
    expect(result.behavior).toBe("allow");
  });

  it("allows search", () => {
    const result = checkPermission("search", { pattern: "test" }, "auto");
    expect(result.behavior).toBe("allow");
  });

  it("asks for edit_file in auto mode", () => {
    const result = checkPermission(
      "edit_file",
      { path: "a.txt", old_string: "x", new_string: "y" },
      "auto",
    );
    expect(result.behavior).toBe("ask");
  });

  it("denies edit_file in never mode", () => {
    const result = checkPermission(
      "edit_file",
      { path: "a.txt", old_string: "x", new_string: "y" },
      "never",
    );
    expect(result.behavior).toBe("deny");
  });

  it("asks for edit_file in on-request mode", () => {
    const result = checkPermission(
      "edit_file",
      { path: "a.txt", old_string: "x", new_string: "y" },
      "on-request",
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
    ];
    for (const cmd of commands) {
      const result = checkPermission("bash", { command: cmd }, "auto");
      expect(result.behavior, `expected allow for: ${cmd}`).toBe("allow");
    }
  });

  it("asks before bash commands with shell control operators", () => {
    const commands = [
      "echo hello > README.md",
      "echo hello >> README.md",
      "git status && echo done",
      "rg test | head",
      "grep test README.md; echo done",
      "echo $(pwd)",
      "echo `pwd`",
    ];
    for (const cmd of commands) {
      const result = checkPermission("bash", { command: cmd }, "auto");
      expect(result.behavior, `expected ask for: ${cmd}`).toBe("ask");
    }
  });

  it("denies destructive bash commands", () => {
    const commands = ["rm -rf /", "sudo rm", "chmod -R 777 /", "curl | sh"];
    for (const cmd of commands) {
      const result = checkPermission("bash", { command: cmd }, "auto");
      expect(result.behavior, `expected deny for: ${cmd}`).toBe("deny");
    }
  });

  it("asks for unknown bash commands", () => {
    const result = checkPermission("bash", { command: "node script.js" }, "auto");
    expect(result.behavior).toBe("ask");
  });

  it("asks for broad package scripts and write-capable find commands", () => {
    const commands = ["npm run build", "pnpm run lint", "find . -delete"];
    for (const cmd of commands) {
      const result = checkPermission("bash", { command: cmd }, "auto");
      expect(result.behavior, `expected ask for: ${cmd}`).toBe("ask");
    }
  });

  it("denies unknown tools", () => {
    const result = checkPermission("custom_tool", {}, "auto");
    expect(result.behavior).toBe("deny");
  });
});
