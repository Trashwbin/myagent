import { describe, it, expect } from "vitest";
import { applyPatchTool } from "../src/tools/apply-patch.js";
import {
  parsePatch,
  resolvePatchPaths,
  applyHunks,
  buildPatchDiffMeta,
} from "../src/tools/apply-patch.js";
import type { ToolContext } from "../src/tools/tool.js";
import { checkToolPermission } from "../src/permission/policy.js";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

function makeContext(cwd: string, overrides: Partial<ToolContext> = {}): ToolContext {
  return { cwd, permissionResolved: false, ...overrides };
}

const ADD_PATCH = `*** Begin Patch
*** Add File: hello.txt
+hello world
*** End Patch`;

const UPDATE_PATCH = (oldText: string, newText: string, path: string) => `*** Begin Patch
*** Update File: ${path}
@@
-${oldText}
+${newText}
*** End Patch`;

const DELETE_PATCH = (path: string) => `*** Begin Patch
*** Delete File: ${path}
*** End Patch`;

// --- Parser ---

describe("parsePatch", () => {
  it("parses an add file operation", () => {
    const result = parsePatch(ADD_PATCH);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toEqual({
      type: "add",
      path: "hello.txt",
      content: "hello world",
    });
  });

  it("parses an update file operation", () => {
    const patch = `*** Begin Patch
*** Update File: src/app.ts
@@
-old
+new
*** End Patch`;
    const result = parsePatch(patch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations).toHaveLength(1);
    const op = result.operations[0];
    expect(op.type).toBe("update");
    if (op.type !== "update") return;
    expect(op.path).toBe("src/app.ts");
    expect(op.hunks).toHaveLength(1);
    expect(op.hunks[0]).toEqual({
      changeContexts: [],
      oldLines: ["old"],
      newLines: ["new"],
    });
  });

  it("parses a delete file operation", () => {
    const result = parsePatch(DELETE_PATCH("old.txt"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toEqual({ type: "delete", path: "old.txt" });
  });

  it("parses multiple operations in one patch", () => {
    const patch = `*** Begin Patch
*** Add File: new.txt
+content
*** Update File: existing.ts
@@
-old
+new
*** Delete File: gone.txt
*** End Patch`;
    const result = parsePatch(patch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations).toHaveLength(3);
    expect(result.operations[0].type).toBe("add");
    expect(result.operations[1].type).toBe("update");
    expect(result.operations[2].type).toBe("delete");
  });

  it("parses update with context lines", () => {
    const patch = `*** Begin Patch
*** Update File: app.ts
@@
 line1
-old
+new
 line3
*** End Patch`;
    const result = parsePatch(patch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const op = result.operations[0];
    if (op.type !== "update") return;
    expect(op.hunks[0]).toEqual({
      changeContexts: [],
      oldLines: ["line1", "old", "line3"],
      newLines: ["line1", "new", "line3"],
    });
  });

  it("parses multiple hunks", () => {
    const patch = `*** Begin Patch
*** Update File: app.ts
@@
-old1
+new1
@@
-old2
+new2
*** End Patch`;
    const result = parsePatch(patch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const op = result.operations[0];
    if (op.type !== "update") return;
    expect(op.hunks).toHaveLength(2);
  });

  it("parses @@ with change context", () => {
    const patch = `*** Begin Patch
*** Update File: app.ts
@@ function greet():
-old
+new
*** End Patch`;
    const result = parsePatch(patch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const op = result.operations[0];
    if (op.type !== "update") return;
    expect(op.hunks[0].changeContexts).toEqual(["function greet():"]);
  });

  it("parses @@ -1,3 +1,4 @@ unified-style header (ignores line numbers)", () => {
    const patch = `*** Begin Patch
*** Update File: app.ts
@@ -1,3 +1,4 @@
 line1
-old
+new
 line3
*** End Patch`;
    const result = parsePatch(patch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const op = result.operations[0];
    if (op.type !== "update") return;
    expect(op.hunks[0].oldLines).toEqual(["line1", "old", "line3"]);
    expect(op.hunks[0].newLines).toEqual(["line1", "new", "line3"]);
  });

  it("parses *** End of File as EOF anchor", () => {
    const patch = `*** Begin Patch
*** Update File: app.ts
@@
-old
+new
*** End of File
*** End Patch`;
    const result = parsePatch(patch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const op = result.operations[0];
    if (op.type !== "update") return;
    expect(op.hunks[0].isEndOfFile).toBe(true);
  });

  it("parses multiple @@ context lines for nested navigation", () => {
    const patch = `*** Begin Patch
*** Update File: app.ts
@@ class Base
@@   def method():
-old
+new
*** End Patch`;
    const result = parsePatch(patch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const op = result.operations[0];
    if (op.type !== "update") return;
    expect(op.hunks[0].changeContexts).toEqual(["class Base", "def method():"]);
  });

  it("rejects missing Begin Patch", () => {
    const result = parsePatch("*** Add File: x\n+content\n*** End Patch");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Begin Patch");
  });

  it("rejects empty patch", () => {
    const result = parsePatch("*** Begin Patch\n*** End Patch");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no operations");
  });

  it("rejects invalid lines", () => {
    const result = parsePatch("*** Begin Patch\nhello\n*** End Patch");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Invalid patch line");
  });

  it("rejects *** Move File", () => {
    const result = parsePatch(
      "*** Begin Patch\n*** Move File: a.txt to b.txt\n*** End Patch",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Move File is not supported");
  });

  it("rejects *** Move to: inside Update File without hunks", () => {
    const patch = `*** Begin Patch
*** Update File: a.txt
*** Move to: b.txt
*** End Patch`;
    const result = parsePatch(patch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no hunks");
  });

  it("parses *** Move to: after Update File with hunks", () => {
    const patch = `*** Begin Patch
*** Update File: a.txt
*** Move to: b.txt
@@
-old
+new
*** End Patch`;
    const result = parsePatch(patch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const op = result.operations[0];
    if (op.type !== "update") return;
    expect(op.movePath).toBe("b.txt");
    expect(op.hunks).toHaveLength(1);
  });

  it("rejects *** Move to: at top level", () => {
    const patch = `*** Begin Patch
*** Move to: b.txt
*** End Patch`;
    const result = parsePatch(patch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("only valid after *** Update File");
  });

  it("rejects duplicate path between source and move destination", () => {
    const patch = `*** Begin Patch
*** Update File: a.txt
*** Move to: a.txt
@@
-old
+new
*** End Patch`;
    const result = parsePatch(patch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("duplicate");
  });

  it("rejects update with no hunks", () => {
    const result = parsePatch("*** Begin Patch\n*** Update File: a.txt\n*** End Patch");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no hunks");
  });

  it("rejects duplicate paths", () => {
    const patch = `*** Begin Patch
*** Add File: a.txt
+content
*** Delete File: a.txt
*** End Patch`;
    const result = parsePatch(patch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("duplicate");
  });

  it("rejects patch without End Patch marker", () => {
    const patch = "*** Begin Patch\n*** Add File: x.txt\n+content";
    const result = parsePatch(patch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("End Patch");
  });

  it("rejects Add File with non-+ content line", () => {
    const patch = `*** Begin Patch
*** Add File: x.txt
+good line
bad line
*** End Patch`;
    const result = parsePatch(patch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('does not start with "+"');
  });

  it("rejects standard unified diff ---/+++ with clear message", () => {
    const patch = `*** Begin Patch
*** Update File: app.ts
--- a/app.ts
+++ b/app.ts
*** End Patch`;
    const result = parsePatch(patch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("unified diff");
    }
  });

  it("rejects mixed unified diff headers + valid hunks", () => {
    const patch = `*** Begin Patch
*** Update File: app.ts
--- a/app.ts
+++ b/app.ts
@@
-old
+new
*** End Patch`;
    const result = parsePatch(patch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("unified diff");
    }
  });

  it("parses @@ hello world @@ as context 'hello world'", () => {
    const patch = `*** Begin Patch
*** Update File: app.ts
@@ hello world @@
-old
+new
*** End Patch`;
    const result = parsePatch(patch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const op = result.operations[0];
    if (op.type !== "update") return;
    expect(op.hunks[0].changeContexts).toEqual(["hello world"]);
  });

  it("parses @@ -1,3 +1,4 @@ fn greet as context 'fn greet'", () => {
    const patch = `*** Begin Patch
*** Update File: app.ts
@@ -1,3 +1,4 @@ fn greet
-old
+new
*** End Patch`;
    const result = parsePatch(patch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const op = result.operations[0];
    if (op.type !== "update") return;
    expect(op.hunks[0].changeContexts).toEqual(["fn greet"]);
  });

  it("parses @@ context @@ followed by another @@ line", () => {
    const patch = `*** Begin Patch
*** Update File: app.ts
@@ class Base @@
@@ method
-old
+new
*** End Patch`;
    const result = parsePatch(patch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const op = result.operations[0];
    if (op.type !== "update") return;
    expect(op.hunks[0].changeContexts).toEqual(["class Base", "method"]);
  });

  it("rejects ambiguous @@ with @@ in middle and no trailing close", () => {
    const patch = `*** Begin Patch
*** Update File: app.ts
@@ ctx @@ trailing
-old
+new
*** End Patch`;
    const result = parsePatch(patch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Ambiguous");
    }
  });

  it("parses add file with multiline content", () => {
    const patch = `*** Begin Patch
*** Add File: multi.ts
+line1
+line2
+line3
*** End Patch`;
    const result = parsePatch(patch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations[0]).toEqual({
      type: "add",
      path: "multi.ts",
      content: "line1\nline2\nline3",
    });
  });
});

// --- Path validation ---

describe("resolvePatchPaths", () => {
  it("resolves valid relative paths", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    const parsed = parsePatch(ADD_PATCH);
    if (!parsed.ok) return;
    const result = resolvePatchPaths(parsed.operations, tmp);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolved.get("hello.txt")).toBe(join(tmp, "hello.txt"));
    await rm(tmp, { recursive: true });
  });

  it("rejects absolute paths", () => {
    const patch = `*** Begin Patch
*** Add File: /etc/passwd
+content
*** End Patch`;
    const parsed = parsePatch(patch);
    if (!parsed.ok) return;
    const result = resolvePatchPaths(parsed.operations, "/workspace");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("escapes workspace");
  });

  it("rejects .. path traversal", () => {
    const patch = `*** Begin Patch
*** Add File: ../outside.txt
+content
*** End Patch`;
    const parsed = parsePatch(patch);
    if (!parsed.ok) return;
    const result = resolvePatchPaths(parsed.operations, "/workspace");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("escapes workspace");
  });

  it("rejects path outside workspace", () => {
    const patch = `*** Begin Patch
*** Add File: ../../outside.txt
+content
*** End Patch`;
    const parsed = parsePatch(patch);
    if (!parsed.ok) return;
    const result = resolvePatchPaths(parsed.operations, "/workspace/project");
    expect(result.ok).toBe(false);
  });
});

// --- Hunk application ---

describe("applyHunks", () => {
  it("applies a simple replacement", () => {
    const result = applyHunks("hello", [
      { changeContexts: [], oldLines: ["hello"], newLines: ["goodbye"] },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toBe("goodbye");
  });

  it("does not match deleted text inside a line substring", () => {
    const result = applyHunks("hello world", [
      { changeContexts: [], oldLines: ["hello"], newLines: ["goodbye"] },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not found");
  });

  it("applies replacement with context", () => {
    const result = applyHunks("line1\nline2\nline3", [
      {
        changeContexts: [],
        oldLines: ["line1", "line2", "line3"],
        newLines: ["line1", "modified", "line3"],
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toBe("line1\nmodified\nline3");
  });

  it("applies multiple hunks with cursor progression", () => {
    const content = "aaa\nbbb\nccc\nbbb\nddd";
    const result = applyHunks(content, [
      { changeContexts: [], oldLines: ["bbb"], newLines: ["BBB"] },
      { changeContexts: [], oldLines: ["bbb"], newLines: ["BBB"] },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toBe("aaa\nBBB\nccc\nBBB\nddd");
  });

  it("fails when context does not match", () => {
    const result = applyHunks("hello world", [
      { changeContexts: [], oldLines: ["goodbye"], newLines: ["hello"] },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not found");
  });

  it("handles addition-only hunk with context", () => {
    const result = applyHunks("line1\nline3", [
      {
        changeContexts: [],
        oldLines: ["line1", "line3"],
        newLines: ["line1", "line2", "line3"],
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toBe("line1\nline2\nline3");
  });

  it("handles pure insertion-only hunk at EOF", () => {
    const result = applyHunks("line1\nline2", [
      {
        changeContexts: [],
        oldLines: [],
        newLines: ["line3"],
        isEndOfFile: true,
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toBe("line1\nline2\nline3");
  });

  it("handles pure insertion-only hunk after context", () => {
    const result = applyHunks("line1\nline3", [
      {
        changeContexts: ["line1"],
        oldLines: [],
        newLines: ["line2"],
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toBe("line1\nline2\nline3");
  });

  it("handles removal-only hunk", () => {
    const result = applyHunks("line1\nline2\nline3", [
      {
        changeContexts: [],
        oldLines: ["line1", "line2", "line3"],
        newLines: ["line1", "line3"],
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toBe("line1\nline3");
  });

  it("uses changeContext to locate correct block among duplicates", () => {
    const content = "class A:\n  x = 1\n  y = 2\nclass B:\n  x = 1\n  y = 3";
    const result = applyHunks(content, [
      {
        changeContexts: ["class B:"],
        oldLines: ["  y = 3"],
        newLines: ["  y = 4"],
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toContain("class B:\n  x = 1\n  y = 4");
    expect(result.result).toContain("class A:\n  x = 1\n  y = 2");
  });

  it("prefers EOF match when isEndOfFile is set", () => {
    const content = "dup\nmiddle\ndup";
    const result = applyHunks(content, [
      {
        changeContexts: [],
        oldLines: ["dup"],
        newLines: ["replaced"],
        isEndOfFile: true,
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toBe("dup\nmiddle\nreplaced");
  });

  it("matches with trimEnd fallback", () => {
    const content = "hello   \nworld";
    const result = applyHunks(content, [
      {
        changeContexts: [],
        oldLines: ["hello", "world"],
        newLines: ["hi", "world"],
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toBe("hi\nworld");
  });

  it("matches with trim fallback", () => {
    const content = "  hello  \n  world  ";
    const result = applyHunks(content, [
      {
        changeContexts: [],
        oldLines: ["hello", "world"],
        newLines: ["hi", "world"],
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Trim matching finds the position, replacement uses newLines as-is
    expect(result.result).toBe("hi\nworld");
  });

  it("preserves trailing newline", () => {
    const result = applyHunks("old\n", [
      { changeContexts: [], oldLines: ["old"], newLines: ["new"] },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toBe("new\n");
  });
});

// --- Tool execution ---

describe("apply_patch tool", () => {
  it("adds a new file", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    const ctx = makeContext(tmp);

    const result = await applyPatchTool.execute({ patch: ADD_PATCH }, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("added hello.txt");

    const content = await readFile(join(tmp, "hello.txt"), "utf-8");
    expect(content).toBe("hello world");

    await rm(tmp, { recursive: true });
  });

  it("adds file in nested directory", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    const ctx = makeContext(tmp);

    const patch = `*** Begin Patch
*** Add File: src/utils/helper.ts
+export const x = 1;
*** End Patch`;

    const result = await applyPatchTool.execute({ patch }, ctx);
    expect(result.ok).toBe(true);

    const content = await readFile(join(tmp, "src", "utils", "helper.ts"), "utf-8");
    expect(content).toBe("export const x = 1;");

    await rm(tmp, { recursive: true });
  });

  it("updates an existing file with context hunk", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "app.ts"), "line1\nold\nline3");
    const ctx = makeContext(tmp);

    const patch = `*** Begin Patch
*** Update File: app.ts
@@
 line1
-old
+new
 line3
*** End Patch`;

    const result = await applyPatchTool.execute({ patch }, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("updated app.ts");

    const content = await readFile(join(tmp, "app.ts"), "utf-8");
    expect(content).toBe("line1\nnew\nline3");

    await rm(tmp, { recursive: true });
  });

  it("deletes an existing file", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "old.txt"), "to be deleted");
    const ctx = makeContext(tmp);

    const result = await applyPatchTool.execute({ patch: DELETE_PATCH("old.txt") }, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("deleted old.txt");
    expect(existsSync(join(tmp, "old.txt"))).toBe(false);

    await rm(tmp, { recursive: true });
  });

  it("applies multi-file patch atomically", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "update.txt"), "old content");
    await writeFile(join(tmp, "delete.txt"), "delete me");
    const ctx = makeContext(tmp);

    const patch = `*** Begin Patch
*** Add File: new.txt
+new file
*** Update File: update.txt
@@
-old content
+new content
*** Delete File: delete.txt
*** End Patch`;

    const result = await applyPatchTool.execute({ patch }, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("added new.txt");
    expect(result.output).toContain("updated update.txt");
    expect(result.output).toContain("deleted delete.txt");

    expect(await readFile(join(tmp, "new.txt"), "utf-8")).toBe("new file");
    expect(await readFile(join(tmp, "update.txt"), "utf-8")).toBe("new content");
    expect(existsSync(join(tmp, "delete.txt"))).toBe(false);

    await rm(tmp, { recursive: true });
  });

  it("rejects add when file already exists", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "hello.txt"), "existing");
    const ctx = makeContext(tmp);

    const result = await applyPatchTool.execute({ patch: ADD_PATCH }, ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("already exists");

    expect(await readFile(join(tmp, "hello.txt"), "utf-8")).toBe("existing");

    await rm(tmp, { recursive: true });
  });

  it("rejects update when file does not exist", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    const ctx = makeContext(tmp);

    const result = await applyPatchTool.execute(
      { patch: UPDATE_PATCH("old", "new", "missing.txt") },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.output).toContain("does not exist");

    await rm(tmp, { recursive: true });
  });

  it("rejects delete when file does not exist", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    const ctx = makeContext(tmp);

    const result = await applyPatchTool.execute(
      { patch: DELETE_PATCH("missing.txt") },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.output).toContain("does not exist");

    await rm(tmp, { recursive: true });
  });

  it("rejects invalid patch format", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    const ctx = makeContext(tmp);

    const result = await applyPatchTool.execute({ patch: "not a patch" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("Begin Patch");

    await rm(tmp, { recursive: true });
  });

  it("rejects absolute path in patch", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    const ctx = makeContext(tmp);

    const patch = `*** Begin Patch
*** Add File: /etc/evil.txt
+content
*** End Patch`;

    const result = await applyPatchTool.execute({ patch }, ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("escapes workspace");

    await rm(tmp, { recursive: true });
  });

  it("rejects .. path in patch", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    const ctx = makeContext(tmp);

    const patch = `*** Begin Patch
*** Add File: ../outside.txt
+content
*** End Patch`;

    const result = await applyPatchTool.execute({ patch }, ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("escapes workspace");

    await rm(tmp, { recursive: true });
  });

  it("rejects update when context does not match", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "app.ts"), "line1\nactual\nline3");
    const ctx = makeContext(tmp);

    const patch = `*** Begin Patch
*** Update File: app.ts
@@
 line1
-wrong
+new
 line3
*** End Patch`;

    const result = await applyPatchTool.execute({ patch }, ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("partially matches");

    expect(await readFile(join(tmp, "app.ts"), "utf-8")).toBe("line1\nactual\nline3");

    await rm(tmp, { recursive: true });
  });

  it("failure does not partially write", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "existing.txt"), "keep this");
    const ctx = makeContext(tmp);

    const patch = `*** Begin Patch
*** Add File: new.txt
+new file content
*** Update File: existing.txt
@@
-wrong context
+replacement
*** End Patch`;

    const result = await applyPatchTool.execute({ patch }, ctx);
    expect(result.ok).toBe(false);

    expect(existsSync(join(tmp, "new.txt"))).toBe(false);
    expect(await readFile(join(tmp, "existing.txt"), "utf-8")).toBe("keep this");

    await rm(tmp, { recursive: true });
  });

  it("rolls back earlier writes when execution fails after preflight", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "app.ts"), "old\n");
    await writeFile(join(tmp, "blocker"), "not a directory");
    const ctx = makeContext(tmp);

    const patch = `*** Begin Patch
*** Update File: app.ts
@@
-old
+new
*** Add File: blocker/new.txt
+content
*** End Patch`;

    const result = await applyPatchTool.execute({ patch }, ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("rolled back");
    expect(await readFile(join(tmp, "app.ts"), "utf-8")).toBe("old\n");
    expect(await readFile(join(tmp, "blocker"), "utf-8")).toBe("not a directory");

    await rm(tmp, { recursive: true });
  });

  it("includes diff in successful result", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "app.ts"), "old\n");
    const ctx = makeContext(tmp);

    const patch = `*** Begin Patch
*** Update File: app.ts
@@
-old
+new
*** End Patch`;

    const result = await applyPatchTool.execute({ patch }, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("-old");
    expect(result.output).toContain("+new");

    await rm(tmp, { recursive: true });
  });

  it("does not include sensitive path diffs in successful result", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, ".env"), "TOKEN=old\n");
    const ctx = makeContext(tmp);

    const patch = `*** Begin Patch
*** Delete File: .env
*** End Patch`;

    const result = await applyPatchTool.execute({ patch }, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("deleted .env");
    expect(result.output).not.toContain("TOKEN=old");
    expect(result.output).not.toContain("--- a/.env");

    await rm(tmp, { recursive: true });
  });

  it("uses resolvedPaths when permissionResolved", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    const ctx = makeContext(tmp, { permissionResolved: true });

    const resolvedPaths = { "hello.txt": join(tmp, "hello.txt") };

    const result = await applyPatchTool.execute({ patch: ADD_PATCH, resolvedPaths }, ctx);
    expect(result.ok).toBe(true);

    const content = await readFile(join(tmp, "hello.txt"), "utf-8");
    expect(content).toBe("hello world");

    await rm(tmp, { recursive: true });
  });

  it("updates with @@ -1,3 +1,4 @@ unified-style header", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "app.ts"), "line1\nold\nline3");
    const ctx = makeContext(tmp);

    const patch = `*** Begin Patch
*** Update File: app.ts
@@ -1,3 +1,4 @@
 line1
-old
+new
 line3
*** End Patch`;

    const result = await applyPatchTool.execute({ patch }, ctx);
    expect(result.ok).toBe(true);
    expect(await readFile(join(tmp, "app.ts"), "utf-8")).toBe("line1\nnew\nline3");

    await rm(tmp, { recursive: true });
  });

  it("updates with @@ context to locate among duplicates", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(
      join(tmp, "app.ts"),
      "class A:\n  x = 1\n  y = 2\nclass B:\n  x = 1\n  y = 3\n",
    );
    const ctx = makeContext(tmp);

    const patch = `*** Begin Patch
*** Update File: app.ts
@@ class B:
-  y = 3
+  y = 4
*** End Patch`;

    const result = await applyPatchTool.execute({ patch }, ctx);
    expect(result.ok).toBe(true);
    const content = await readFile(join(tmp, "app.ts"), "utf-8");
    expect(content).toContain("class B:\n  x = 1\n  y = 4");
    expect(content).toContain("class A:\n  x = 1\n  y = 2");

    await rm(tmp, { recursive: true });
  });

  it("applies multi-hunk update with cursor progression", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "f.txt"), "aaa\nbbb\nccc\nbbb\nddd");
    const ctx = makeContext(tmp);

    const patch = `*** Begin Patch
*** Update File: f.txt
@@
-bbb
+BBB
@@
-bbb
+BBB
*** End Patch`;

    const result = await applyPatchTool.execute({ patch }, ctx);
    expect(result.ok).toBe(true);
    expect(await readFile(join(tmp, "f.txt"), "utf-8")).toBe("aaa\nBBB\nccc\nBBB\nddd");

    await rm(tmp, { recursive: true });
  });

  it("insertion-only hunk adds lines at context position", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "f.txt"), "line1\nline3\n");
    const ctx = makeContext(tmp);

    const patch = `*** Begin Patch
*** Update File: f.txt
@@
 line1
+line2
 line3
*** End Patch`;

    const result = await applyPatchTool.execute({ patch }, ctx);
    expect(result.ok).toBe(true);
    expect(await readFile(join(tmp, "f.txt"), "utf-8")).toBe("line1\nline2\nline3\n");

    await rm(tmp, { recursive: true });
  });

  it("EOF anchor matches from end of file", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "f.txt"), "dup\nmiddle\ndup\n");
    const ctx = makeContext(tmp);

    const patch = `*** Begin Patch
*** Update File: f.txt
@@
-dup
+replaced
*** End of File
*** End Patch`;

    const result = await applyPatchTool.execute({ patch }, ctx);
    expect(result.ok).toBe(true);
    expect(await readFile(join(tmp, "f.txt"), "utf-8")).toBe("dup\nmiddle\nreplaced\n");

    await rm(tmp, { recursive: true });
  });

  it("CRLF file stays CRLF after update", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "crlf.txt"), "line1\r\nold\r\nline3\r\n");
    const ctx = makeContext(tmp);

    const patch = `*** Begin Patch
*** Update File: crlf.txt
@@
 line1
-old
+new
 line3
*** End Patch`;

    const result = await applyPatchTool.execute({ patch }, ctx);
    expect(result.ok).toBe(true);

    const content = await readFile(join(tmp, "crlf.txt"), "utf-8");
    expect(content).toContain("\r\n");
    expect(content).not.toMatch(/(?<!\r)\n/);
    expect(content).toContain("new");

    await rm(tmp, { recursive: true });
  });

  it("approval-passing patch executes with same semantics", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "app.ts"), "line1\nold\nline3");

    const patch = `*** Begin Patch
*** Update File: app.ts
@@ line1
-old
+new
*** End Patch`;

    // Verify permission passes
    const decision = checkToolPermission("apply_patch", { patch }, "auto", tmp);
    expect(decision.behavior).toBe("ask");
    expect(decision.metadata?.additions).toBe(1);
    expect(decision.metadata?.deletions).toBe(1);

    // Verify execution produces same result
    const ctx = makeContext(tmp);
    const result = await applyPatchTool.execute({ patch }, ctx);
    expect(result.ok).toBe(true);
    const content = await readFile(join(tmp, "app.ts"), "utf-8");
    expect(content).toBe("line1\nnew\nline3");

    await rm(tmp, { recursive: true });
  });
});

describe("buildPatchDiffMeta", () => {
  it("returns affected paths and diff stats", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "app.ts"), "old\n");

    const patch = `*** Begin Patch
*** Add File: new.txt
+new content
*** Update File: app.ts
@@
-old
+new
*** End Patch`;

    const parsed = parsePatch(patch);
    if (!parsed.ok) return;

    const meta = buildPatchDiffMeta(parsed.operations, tmp);
    expect(meta.affectedPaths).toEqual(["new.txt", "app.ts"]);
    expect(meta.additions).toBeGreaterThan(0);
    expect(meta.diff).toContain("+new");

    await rm(tmp, { recursive: true });
  });

  it("includes deletion diff", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "gone.txt"), "content");

    const parsed = parsePatch(DELETE_PATCH("gone.txt"));
    if (!parsed.ok) return;

    const meta = buildPatchDiffMeta(parsed.operations, tmp);
    expect(meta.affectedPaths).toEqual(["gone.txt"]);
    expect(meta.deletions).toBeGreaterThan(0);

    await rm(tmp, { recursive: true });
  });

  it("Add File diff stats are +N -0", async () => {
    const parsed = parsePatch(
      `*** Begin Patch\n*** Add File: hello.txt\n+line1\n+line2\n+line3\n*** End Patch`,
    );
    if (!parsed.ok) return;

    const meta = buildPatchDiffMeta(parsed.operations, "/tmp/workspace");
    expect(meta.additions).toBe(3);
    expect(meta.deletions).toBe(0);
  });

  it("CRLF update diff matches execution output", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "crlf.txt"), "line1\r\nold\r\nline3\r\n");

    const patch = `*** Begin Patch
*** Update File: crlf.txt
@@
-old
+new
*** End Patch`;

    const parsed = parsePatch(patch);
    if (!parsed.ok) return;

    const meta = buildPatchDiffMeta(parsed.operations, tmp);
    // Before the fix, CRLF files would show whole-file rewrite (3+ additions, 3+ deletions)
    expect(meta.additions).toBe(1);
    expect(meta.deletions).toBe(1);

    await rm(tmp, { recursive: true });
  });

  it("reports hunk failures without computing diff", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "app.ts"), "line1\nactual\nline3");

    const patch = `*** Begin Patch
*** Update File: app.ts
@@
 line1
-wrong
+new
 line3
*** End Patch`;

    const parsed = parsePatch(patch);
    if (!parsed.ok) return;

    const meta = buildPatchDiffMeta(parsed.operations, tmp);
    expect(meta.failures.length).toBeGreaterThan(0);
    expect(meta.failures[0]).toContain("partially matches");
    expect(meta.diff).toBe("");

    await rm(tmp, { recursive: true });
  });
});

describe("apply_patch permission metadata", () => {
  it("does not include diff for sensitive paths", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, ".env"), "TOKEN=old\n");

    const patch = `*** Begin Patch
*** Update File: .env
@@
-TOKEN=old
+TOKEN=new
*** End Patch`;

    const decision = checkToolPermission("apply_patch", { patch }, "auto", tmp);
    expect(decision.behavior).toBe("ask");
    expect(decision.metadata?.sensitive).toBe(true);
    expect(decision.metadata?.affectedPaths).toEqual([".env"]);
    expect(decision.metadata?.diff).toBeUndefined();
    expect(JSON.stringify(decision.metadata)).not.toContain("TOKEN=old");

    await rm(tmp, { recursive: true });
  });

  it("denies update patch when hunk cannot apply", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "app.ts"), "line1\nactual\nline3");

    const patch = `*** Begin Patch
*** Update File: app.ts
@@
 line1
-wrong
+new
 line3
*** End Patch`;

    const decision = checkToolPermission("apply_patch", { patch }, "auto", tmp);
    expect(decision.behavior).toBe("deny");
    expect(decision.reason).toContain("will fail");
    expect(decision.metadata?.failures).toBeDefined();
    expect((decision.metadata!.failures as string[]).length).toBeGreaterThan(0);

    await rm(tmp, { recursive: true });
  });

  it("denies update patch when file does not exist", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));

    const patch = `*** Begin Patch
*** Update File: nonexistent.ts
@@
-old
+new
*** End Patch`;

    const decision = checkToolPermission("apply_patch", { patch }, "auto", tmp);
    expect(decision.behavior).toBe("deny");
    expect(decision.reason).toContain("does not exist");

    await rm(tmp, { recursive: true });
  });

  it("denies add patch when file already exists", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "hello.txt"), "existing");

    const decision = checkToolPermission("apply_patch", { patch: ADD_PATCH }, "auto", tmp);
    expect(decision.behavior).toBe("deny");
    expect(decision.reason).toContain("already exists");

    await rm(tmp, { recursive: true });
  });

  it("denies add patch when path is an existing directory", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    const { mkdir: mkdirAsync } = await import("node:fs/promises");
    await mkdirAsync(join(tmp, "src"));

    const patch = `*** Begin Patch
*** Add File: src
+content
*** End Patch`;

    const decision = checkToolPermission("apply_patch", { patch }, "auto", tmp);
    expect(decision.behavior).toBe("deny");
    expect(decision.reason).toContain("already exists");

    await rm(tmp, { recursive: true });
  });

  it("denies delete patch when file does not exist", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));

    const decision = checkToolPermission(
      "apply_patch",
      { patch: DELETE_PATCH("missing.txt") },
      "auto",
      tmp,
    );
    expect(decision.behavior).toBe("deny");
    expect(decision.reason).toContain("does not exist");

    await rm(tmp, { recursive: true });
  });

  it("shows diff for valid patch with both add and update", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "app.ts"), "old\n");

    const patch = `*** Begin Patch
*** Add File: new.txt
+new content
*** Update File: app.ts
@@
-old
+new
*** End Patch`;

    const decision = checkToolPermission("apply_patch", { patch }, "auto", tmp);
    expect(decision.behavior).toBe("ask");
    expect(decision.metadata?.diff).toContain("+new");
    expect(decision.metadata?.additions).toBeGreaterThan(0);

    await rm(tmp, { recursive: true });
  });

  it("does not validate hunks for sensitive paths", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, ".env"), "TOKEN=old\n");

    const patch = `*** Begin Patch
*** Update File: .env
@@
-TOTALLY_WRONG
+new
*** End Patch`;

    const decision = checkToolPermission("apply_patch", { patch }, "auto", tmp);
    // Sensitive: can't validate hunks, still asks for approval
    expect(decision.behavior).toBe("ask");
    expect(decision.metadata?.sensitive).toBe(true);
    expect(decision.metadata?.failures).toBeUndefined();

    await rm(tmp, { recursive: true });
  });
});

// --- Enhanced matching and failure diagnostics ---

describe("applyHunks matching passes", () => {
  it("matches with collapseWhitespace pass (tab→space)", () => {
    const content = "if (x > 0) {\n\treturn true;\n}";
    const result = applyHunks(content, [
      {
        changeContexts: [],
        oldLines: ["if (x > 0) {", "return true;", "}"],
        newLines: ["if (x > 0) {", "return false;", "}"],
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toBe("if (x > 0) {\nreturn false;\n}");
  });

  it("matches multi-space collapsed to single space", () => {
    const content = "const  x  =  1;";
    const result = applyHunks(content, [
      {
        changeContexts: [],
        oldLines: ["const x = 1;"],
        newLines: ["const x = 2;"],
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toBe("const x = 2;");
  });

  it("matches indented code with different tab width", () => {
    const content = "function main() {\n    console.log('hi');\n}";
    const result = applyHunks(content, [
      {
        changeContexts: [],
        oldLines: ["function main() {", "console.log('hi');", "}"],
        newLines: ["function main() {", "console.log('bye');", "}"],
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toBe("function main() {\nconsole.log('bye');\n}");
  });

  it("rejects ambiguous collapseWhitespace match", () => {
    const content = "const  x  =  1;\nlet y = 2;\nconst  x  =  1;\nlet z = 3;";
    const result = applyHunks(content, [
      {
        changeContexts: [],
        oldLines: ["const x = 1;"],
        newLines: ["const x = 2;"],
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("2 locations");
      expect(result.error).toContain("@@ context");
    }
  });

  it("accepts unambiguous collapseWhitespace match", () => {
    const content = "const  x  =  1;\nlet y = 2;\nlet z = 3;";
    const result = applyHunks(content, [
      {
        changeContexts: [],
        oldLines: ["const x = 1;"],
        newLines: ["const x = 2;"],
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toBe("const x = 2;\nlet y = 2;\nlet z = 3;");
  });
});

describe("applyHunks failure diagnostics", () => {
  it("reports context not found with re-read hint", () => {
    const result = applyHunks("line1\nline2\nline3", [
      {
        changeContexts: ["nonexistent"],
        oldLines: ["line1"],
        newLines: ["line1a"],
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("context");
      expect(result.error).toContain("nonexistent");
      expect(result.error).toContain("not found");
      expect(result.error).toContain("Re-read");
    }
  });

  it("detects exact content exists earlier in file (cursor shift)", () => {
    const result = applyHunks("target\nline1\ntarget\nline3", [
      {
        changeContexts: [],
        oldLines: ["target", "line1", "target"],
        newLines: ["CHANGED", "line1", "target"],
      },
      {
        changeContexts: [],
        oldLines: ["target"],
        newLines: ["NEW"],
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Hunk 2");
      expect(result.error).toContain("earlier in the file");
      expect(result.error).toContain("shifted the cursor");
    }
  });

  it("detects whitespace drift when content exists before cursor", () => {
    const content = "hello   world\nline1\nline2\nline3";
    const result = applyHunks(content, [
      {
        changeContexts: [],
        oldLines: ["line1"],
        newLines: ["LINE1"],
      },
      {
        changeContexts: [],
        oldLines: ["hello world"],
        newLines: ["hello earth"],
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Hunk 2");
      expect(result.error).toContain("whitespace normalization");
      expect(result.error).toContain("Re-read");
    }
  });

  it("detects whitespace drift for old lines match", () => {
    const content = "line1\n  hello   world  \nline3";
    const result = applyHunks(content, [
      {
        changeContexts: [],
        oldLines: ["line1", "hello world", "line3"],
        newLines: ["line1", "goodbye world", "line3"],
      },
    ]);
    expect(result.ok).toBe(true);
  });

  it("reports partial match with percentage when some lines differ", () => {
    const content = "line1\nactual\nline3";
    const result = applyHunks(content, [
      {
        changeContexts: [],
        oldLines: ["line1", "wrong", "line3"],
        newLines: ["line1", "new", "line3"],
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("partially matches");
      expect(result.error).toContain("67%");
      expect(result.error).toContain("Re-read");
    }
  });

  it("reports generic failure when no match at any level", () => {
    const content = "alpha\nbeta\ngamma";
    const result = applyHunks(content, [
      {
        changeContexts: [],
        oldLines: ["completely", "different"],
        newLines: ["new1", "new2"],
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not found");
      expect(result.error).toContain("Re-read");
      expect(result.error).not.toContain("whitespace");
      expect(result.error).not.toContain("partially matches");
    }
  });

  it("includes context position in oldLines failure when context was matched", () => {
    const content = "class A:\n  x = 1\nclass B:\n  y = 2";
    const result = applyHunks(content, [
      {
        changeContexts: ["class B:"],
        oldLines: ["  z = 3"],
        newLines: ["  z = 4"],
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("context matched at line");
      expect(result.error).toContain("not found");
    }
  });

  it("reports multiple fuzzy matches with disambiguation hint", () => {
    const content = "aa  bb\nline1\naa  bb\nline3\nline4\nline5";
    const result = applyHunks(content, [
      {
        changeContexts: [],
        oldLines: ["line1", "aa  bb", "line3"],
        newLines: ["LINE1", "aa  bb", "LINE3"],
      },
      {
        changeContexts: [],
        oldLines: ["aa bb"],
        newLines: ["xx"],
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Hunk 2");
      expect(result.error).toContain("2 locations");
      expect(result.error).toContain("@@ context");
    }
  });

  it("EOF anchor failure mentions end of file", () => {
    const content = "aaa\nbbb\nccc";
    const result = applyHunks(content, [
      {
        changeContexts: [],
        oldLines: ["aaa"],
        newLines: ["AAA"],
      },
      {
        changeContexts: [],
        oldLines: ["aaa"],
        newLines: ["XXX"],
        isEndOfFile: true,
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("end of file");
    }
  });
});

// --- Move to: support ---

describe("resolvePatchPaths with move", () => {
  it("resolves move destination path", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    const patch = `*** Begin Patch
*** Update File: src/a.ts
*** Move to: dest/b.ts
@@
-old
+new
*** End Patch`;
    const parsed = parsePatch(patch);
    if (!parsed.ok) return;
    const result = resolvePatchPaths(parsed.operations, tmp);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resolved.get("src/a.ts")).toBe(join(tmp, "src/a.ts"));
    expect(result.resolved.get("dest/b.ts")).toBe(join(tmp, "dest/b.ts"));
    await rm(tmp, { recursive: true });
  });

  it("rejects absolute move destination", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    const patch = `*** Begin Patch
*** Update File: a.ts
*** Move to: /etc/evil.ts
@@
-old
+new
*** End Patch`;
    const parsed = parsePatch(patch);
    if (!parsed.ok) return;
    const result = resolvePatchPaths(parsed.operations, tmp);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Move destination escapes workspace");
    await rm(tmp, { recursive: true });
  });

  it("rejects .. traversal in move destination", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    const patch = `*** Begin Patch
*** Update File: a.ts
*** Move to: ../outside.ts
@@
-old
+new
*** End Patch`;
    const parsed = parsePatch(patch);
    if (!parsed.ok) return;
    const result = resolvePatchPaths(parsed.operations, tmp);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Move destination escapes workspace");
    await rm(tmp, { recursive: true });
  });
});

describe("apply_patch move execution", () => {
  it("moves file with content change", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "old.ts"), "line1\nold\nline3");
    const ctx = makeContext(tmp);

    const patch = `*** Begin Patch
*** Update File: old.ts
*** Move to: new.ts
@@
-old
+new
*** End Patch`;

    const result = await applyPatchTool.execute({ patch }, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("moved old.ts -> new.ts");

    const content = await readFile(join(tmp, "new.ts"), "utf-8");
    expect(content).toBe("line1\nnew\nline3");
    expect(existsSync(join(tmp, "old.ts"))).toBe(false);

    await rm(tmp, { recursive: true });
  });

  it("moves file to nested directory", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "flat.txt"), "content");
    const ctx = makeContext(tmp);

    const patch = `*** Begin Patch
*** Update File: flat.txt
*** Move to: src/nested/deep.txt
@@
-content
+updated
*** End Patch`;

    const result = await applyPatchTool.execute({ patch }, ctx);
    expect(result.ok).toBe(true);

    const content = await readFile(join(tmp, "src", "nested", "deep.txt"), "utf-8");
    expect(content).toBe("updated");
    expect(existsSync(join(tmp, "flat.txt"))).toBe(false);

    await rm(tmp, { recursive: true });
  });

  it("rejects move when destination already exists", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "src.txt"), "content");
    await writeFile(join(tmp, "dest.txt"), "existing");
    const ctx = makeContext(tmp);

    const patch = `*** Begin Patch
*** Update File: src.txt
*** Move to: dest.txt
@@
-content
+new
*** End Patch`;

    const result = await applyPatchTool.execute({ patch }, ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("already exists");

    // Source unchanged
    expect(await readFile(join(tmp, "src.txt"), "utf-8")).toBe("content");
    // Destination unchanged
    expect(await readFile(join(tmp, "dest.txt"), "utf-8")).toBe("existing");

    await rm(tmp, { recursive: true });
  });

  it("rejects move when destination is a directory", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "src.txt"), "content");
    const { mkdir: mkdirAsync } = await import("node:fs/promises");
    await mkdirAsync(join(tmp, "dest"));
    const ctx = makeContext(tmp);

    const patch = `*** Begin Patch
*** Update File: src.txt
*** Move to: dest
@@
-content
+new
*** End Patch`;

    const result = await applyPatchTool.execute({ patch }, ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("directory");

    await rm(tmp, { recursive: true });
  });

  it("rolls back move on subsequent failure", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "src.txt"), "original");
    const ctx = makeContext(tmp);

    const patch = `*** Begin Patch
*** Update File: src.txt
*** Move to: dest.txt
@@
-original
+updated
*** Update File: nonexistent.txt
@@
-old
+new
*** End Patch`;

    const result = await applyPatchTool.execute({ patch }, ctx);
    expect(result.ok).toBe(false);

    // Source restored
    expect(await readFile(join(tmp, "src.txt"), "utf-8")).toBe("original");
    // Destination not created
    expect(existsSync(join(tmp, "dest.txt"))).toBe(false);

    await rm(tmp, { recursive: true });
  });
});

describe("buildPatchDiffMeta with move", () => {
  it("includes move in metadata", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "old.txt"), "line1\nold\nline3");

    const patch = `*** Begin Patch
*** Update File: old.txt
*** Move to: new.txt
@@
-old
+new
*** End Patch`;

    const parsed = parsePatch(patch);
    if (!parsed.ok) return;

    const meta = buildPatchDiffMeta(parsed.operations, tmp);
    expect(meta.moves).toEqual([{ from: "old.txt", to: "new.txt" }]);
    expect(meta.affectedPaths).toContain("old.txt");
    expect(meta.affectedPaths).toContain("new.txt");
    expect(meta.additions).toBe(1);
    expect(meta.deletions).toBe(1);

    await rm(tmp, { recursive: true });
  });

  it("reports failure when move destination exists", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "src.txt"), "content");
    await writeFile(join(tmp, "dest.txt"), "existing");

    const patch = `*** Begin Patch
*** Update File: src.txt
*** Move to: dest.txt
@@
-content
+new
*** End Patch`;

    const parsed = parsePatch(patch);
    if (!parsed.ok) return;

    const meta = buildPatchDiffMeta(parsed.operations, tmp);
    expect(meta.failures.length).toBeGreaterThan(0);
    expect(meta.failures[0]).toContain("already exists");

    await rm(tmp, { recursive: true });
  });
});

describe("apply_patch move permission", () => {
  it("denies move when destination exists", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "src.txt"), "content");
    await writeFile(join(tmp, "dest.txt"), "existing");

    const patch = `*** Begin Patch
*** Update File: src.txt
*** Move to: dest.txt
@@
-content
+new
*** End Patch`;

    const decision = checkToolPermission("apply_patch", { patch }, "auto", tmp);
    expect(decision.behavior).toBe("deny");
    expect(decision.reason).toContain("already exists");

    await rm(tmp, { recursive: true });
  });

  it("includes moves in approval metadata", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "src.txt"), "content");

    const patch = `*** Begin Patch
*** Update File: src.txt
*** Move to: dest.txt
@@
-content
+updated
*** End Patch`;

    const decision = checkToolPermission("apply_patch", { patch }, "auto", tmp);
    expect(decision.behavior).toBe("ask");
    expect(decision.metadata?.moves).toEqual([{ from: "src.txt", to: "dest.txt" }]);
    expect(decision.metadata?.affectedPaths).toContain("src.txt");
    expect(decision.metadata?.affectedPaths).toContain("dest.txt");

    await rm(tmp, { recursive: true });
  });

  it("marks sensitive when source or destination is sensitive", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, ".env"), "SECRET=old");

    const patch = `*** Begin Patch
*** Update File: .env
*** Move to: backup.env
@@
-SECRET=old
+SECRET=new
*** End Patch`;

    const decision = checkToolPermission("apply_patch", { patch }, "auto", tmp);
    expect(decision.behavior).toBe("ask");
    expect(decision.metadata?.sensitive).toBe(true);
    expect(decision.metadata?.diff).toBeUndefined();

    await rm(tmp, { recursive: true });
  });

  it("resolvedPaths includes move destination", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "src.txt"), "content");

    const patch = `*** Begin Patch
*** Update File: src.txt
*** Move to: dest.txt
@@
-content
+updated
*** End Patch`;

    const decision = checkToolPermission("apply_patch", { patch }, "auto", tmp);
    expect(decision.behavior).toBe("ask");
    const resolved = decision.resolvedInput as { resolvedPaths: Record<string, string> };
    expect(resolved.resolvedPaths["src.txt"]).toBeDefined();
    expect(resolved.resolvedPaths["dest.txt"]).toBeDefined();

    await rm(tmp, { recursive: true });
  });
});
