import { describe, it, expect } from "vitest";
import { buildApprovalDisplay } from "../src/permission/display.js";
import type { ToolPermissionDecision } from "../src/permission/policy.js";
import { checkToolPermission } from "../src/permission/policy.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

describe("buildApprovalDisplay", () => {
  describe("command (bash)", () => {
    it("mkdir shows Create directory? prompt", () => {
      const display = buildApprovalDisplay(
        "bash",
        { command: "mkdir -p test-01/js" },
        makeDecision({ metadata: { intentKind: "fs_primitive" } }),
      );
      expect(display.kind).toBe("command");
      if (display.kind !== "command") return;
      expect(display.prompt).toBe("Create directory?");
      expect(display.subject).toContain("test-01/js");
      expect(display.intent).toBe("filesystem");
    });

    it("generic bash shows Run shell command? prompt", () => {
      const display = buildApprovalDisplay(
        "bash",
        { command: "node script.js" },
        makeDecision({ metadata: {} }),
      );
      expect(display.kind).toBe("command");
      if (display.kind !== "command") return;
      expect(display.prompt).toBe("Run shell command?");
      expect(display.subject).toContain("node script.js");
    });

    it("bash with externalDirectoryPattern shows access kind", () => {
      const display = buildApprovalDisplay(
        "bash",
        { command: "ls /ext/project" },
        makeDecision({
          metadata: {
            externalDirectoryPattern: "/ext/project/*",
          },
        }),
      );
      expect(display.kind).toBe("access");
      if (display.kind !== "access") return;
      expect(display.prompt).toContain("outside the workspace");
      expect(display.scope).toBe("/ext/project/*");
    });

    it("bash with sensitive metadata shows access kind", () => {
      const display = buildApprovalDisplay(
        "bash",
        { command: "cat .env" },
        makeDecision({ metadata: { sensitive: true } }),
      );
      expect(display.kind).toBe("access");
      if (display.kind !== "access") return;
      expect(display.prompt).toContain("sensitive");
    });

    it("bash display does not contain internal reason text", () => {
      const display = buildApprovalDisplay(
        "bash",
        { command: "mkdir -p test-01/js" },
        makeDecision({
          reason: "mkdir is a write-effect command",
          metadata: { intentKind: "fs_primitive" },
        }),
      );
      expect(display.kind).toBe("command");
      if (display.kind !== "command") return;
      expect(display.prompt).not.toContain("write-effect");
      expect(display.subject).not.toContain("write-effect");
    });
  });

  describe("mutation (edit_file)", () => {
    it("edit_file shows generic changes prompt with diff stats", () => {
      const display = buildApprovalDisplay(
        "edit_file",
        { path: "src/app.ts" },
        makeDecision({
          metadata: {
            additions: 3,
            deletions: 1,
            diff: "--- a/app.ts\n+++ b/app.ts\n-old\n+new",
          },
        }),
      );
      expect(display.kind).toBe("mutation");
      if (display.kind !== "mutation") return;
      expect(display.prompt).toBe("Do you want to make these changes?");
      expect(display.files).toHaveLength(1);
      expect(display.files[0].path).toBe("src/app.ts");
      expect(display.files[0].additions).toBe(3);
      expect(display.files[0].deletions).toBe(1);
      expect(display.files[0].diff).toBeDefined();
    });

    it("sensitive edit_file hides diff content", () => {
      const display = buildApprovalDisplay(
        "edit_file",
        { path: ".env" },
        makeDecision({
          metadata: {
            sensitive: true,
          },
        }),
      );
      expect(display.kind).toBe("mutation");
      if (display.kind !== "mutation") return;
      expect(display.files[0].sensitive).toBe(true);
      expect(display.files[0].diff).toBeUndefined();
    });
  });

  describe("mutation (write_file)", () => {
    it("write_file to new file shows generic changes prompt", () => {
      const display = buildApprovalDisplay(
        "write_file",
        { path: "src/new.ts" },
        makeDecision({
          metadata: {
            operation: "create",
            additions: 10,
            deletions: 0,
          },
        }),
      );
      expect(display.kind).toBe("mutation");
      if (display.kind !== "mutation") return;
      expect(display.prompt).toBe("Do you want to make these changes?");
      expect(display.files[0].path).toBe("src/new.ts");
      expect(display.files[0].additions).toBe(10);
    });

    it("sensitive write_file hides content", () => {
      const display = buildApprovalDisplay(
        "write_file",
        { path: ".env" },
        makeDecision({
          metadata: {
            sensitive: true,
          },
        }),
      );
      expect(display.kind).toBe("mutation");
      if (display.kind !== "mutation") return;
      expect(display.files[0].sensitive).toBe(true);
    });
  });

  describe("mutation (apply_patch)", () => {
    it("apply_patch shows per-file diff stats", () => {
      const display = buildApprovalDisplay(
        "apply_patch",
        {},
        makeDecision({
          metadata: {
            affectedPaths: ["index.html", "game.js"],
            additions: 3,
            deletions: 2,
            diff: "--- a/index.html\n+++ b/index.html\n-old\n+new\n--- a/game.js\n+++ b/game.js\n-old2\n+new2",
          },
        }),
      );
      expect(display.kind).toBe("mutation");
      if (display.kind !== "mutation") return;
      expect(display.prompt).toBe("Do you want to make these changes?");
      expect(display.files.length).toBeGreaterThanOrEqual(1);
    });

    it("apply_patch keeps per-file diffs distinct for same basenames", () => {
      const display = buildApprovalDisplay(
        "apply_patch",
        {},
        makeDecision({
          metadata: {
            affectedPaths: ["src/a/index.ts", "src/b/index.ts"],
            diff: [
              "--- a/src/a/index.ts",
              "+++ b/src/a/index.ts",
              "@@ -1 +1 @@",
              "-const value = 'a';",
              "+const value = 'aa';",
              "--- a/src/b/index.ts",
              "+++ b/src/b/index.ts",
              "@@ -1 +1 @@",
              "-const value = 'b';",
              "+const value = 'bb';",
            ].join("\n"),
          },
        }),
      );
      expect(display.kind).toBe("mutation");
      if (display.kind !== "mutation") return;
      expect(display.files).toHaveLength(2);
      expect(display.files[0]).toMatchObject({
        path: "src/a/index.ts",
        additions: 1,
        deletions: 1,
      });
      expect(display.files[0].diff).toContain("--- a/src/a/index.ts");
      expect(display.files[0].diff).toContain("+const value = 'aa';");
      expect(display.files[1]).toMatchObject({
        path: "src/b/index.ts",
        additions: 1,
        deletions: 1,
      });
      expect(display.files[1].diff).toContain("--- a/src/b/index.ts");
      expect(display.files[1].diff).toContain("+const value = 'bb';");
    });

    it("sensitive apply_patch hides all diff content", () => {
      const display = buildApprovalDisplay(
        "apply_patch",
        {},
        makeDecision({
          metadata: {
            sensitive: true,
            affectedPaths: [".env"],
          },
        }),
      );
      expect(display.kind).toBe("mutation");
      if (display.kind !== "mutation") return;
      expect(display.files[0].sensitive).toBe(true);
      expect(display.files[0].diff).toBeUndefined();
    });
  });

  describe("access (Read, grep, glob)", () => {
    it("Read outside workspace shows access prompt", () => {
      const display = buildApprovalDisplay(
        "Read",
        { path: "/etc/passwd" },
        makeDecision({
          metadata: {
            externalDirectoryPattern: "/etc/*",
          },
        }),
      );
      expect(display.kind).toBe("access");
      if (display.kind !== "access") return;
      expect(display.prompt).toContain("outside the workspace");
      expect(display.subject).toBe("/etc/passwd");
      expect(display.scope).toBe("/etc/*");
    });

    it("Read sensitive file shows access prompt", () => {
      const display = buildApprovalDisplay(
        "Read",
        { path: ".env" },
        makeDecision({
          metadata: {
            sensitive: true,
          },
        }),
      );
      expect(display.kind).toBe("access");
      if (display.kind !== "access") return;
      expect(display.prompt).toContain("sensitive");
    });
  });
});

describe("auto-allow mutations in auto mode", () => {
  it("workspace write_file in auto mode is allowed", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-auto-"));
    const decision = checkToolPermission(
      "write_file",
      { path: "new.txt", content: "hello" },
      "auto",
      tmp,
    );
    expect(decision.behavior).toBe("allow");
    await rm(tmp, { recursive: true });
  });

  it("sensitive write_file in auto mode still asks", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-auto-"));
    await writeFile(join(tmp, ".env"), "old");
    const decision = checkToolPermission(
      "write_file",
      { path: ".env", content: "new" },
      "auto",
      tmp,
    );
    expect(decision.behavior).toBe("ask");
    expect(decision.metadata?.sensitive).toBe(true);
    // Display should not leak content
    if (decision.behavior === "ask") {
      const display = buildApprovalDisplay("write_file", { path: ".env", content: "secret-value" }, decision);
      expect(display.kind).toBe("mutation");
      if (display.kind === "mutation") {
        expect(display.files[0].diff).toBeUndefined();
        expect(JSON.stringify(display)).not.toContain("secret-value");
      }
    }
    await rm(tmp, { recursive: true });
  });

  it("apply_patch in auto mode is allowed for non-sensitive workspace patch", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-auto-"));
    const patch = `*** Begin Patch
*** Add File: x.txt
+content
*** End Patch`;
    const decision = checkToolPermission("apply_patch", { patch }, "auto", tmp);
    expect(decision.behavior).toBe("allow");
    await rm(tmp, { recursive: true });
  });

  it("apply_patch approval display has per-file +/- stats", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-auto-"));
    await writeFile(join(tmp, "app.ts"), "old\n");
    const patch = `*** Begin Patch
*** Add File: new.txt
+new content
*** Update File: app.ts
@@
-old
+new
*** End Patch`;

    // Use on-request to get the approval decision
    const decision = checkToolPermission("apply_patch", { patch }, "on-request", tmp);
    expect(decision.behavior).toBe("ask");
    const display = buildApprovalDisplay("apply_patch", { patch }, decision);
    expect(display.kind).toBe("mutation");
    if (display.kind === "mutation") {
      expect(display.prompt).toBe("Do you want to make these changes?");
      expect(display.files.length).toBeGreaterThanOrEqual(1);
      // Files should have additions/deletions
      const totalAdd = display.files.reduce((s, f) => s + f.additions, 0);
      expect(totalAdd).toBeGreaterThan(0);
    }
    await rm(tmp, { recursive: true });
  });

  it("bash mkdir approval display is clean prompt without internal reason", async () => {
    const decision = checkToolPermission(
      "bash",
      { command: "mkdir -p test-01/js" },
      "auto",
      process.cwd(),
    );
    // mkdir is a write-effect command → ask
    expect(decision.behavior).toBe("ask");
    const display = buildApprovalDisplay(
      "bash",
      { command: "mkdir -p test-01/js" },
      decision,
    );
    expect(display.kind).toBe("command");
    if (display.kind !== "command") return;
    expect(display.prompt).toBe("Create directory?");
    // Should NOT contain internal policy reason
    expect(display.prompt).not.toContain("write-effect");
    expect(display.prompt).not.toContain("mkdir is a");
  });
});

describe("web bundle does not expose raw input", () => {
  it("ApprovalDisplay does not serialize raw input", () => {
    const decision = makeDecision({
      metadata: { additions: 1, deletions: 0 },
    });
    const display = buildApprovalDisplay(
      "write_file",
      { path: "test.ts", content: "sensitive-content-here" },
      decision,
    );
    const serialized = JSON.stringify(display);
    expect(serialized).not.toContain("sensitive-content-here");
    expect(serialized).not.toContain("content");
  });
});
