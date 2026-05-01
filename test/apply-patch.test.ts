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
    expect(op.hunks[0]).toEqual([
      { prefix: "-", text: "old" },
      { prefix: "+", text: "new" },
    ]);
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
    expect(op.hunks[0]).toEqual([
      { prefix: " ", text: "line1" },
      { prefix: "-", text: "old" },
      { prefix: "+", text: "new" },
      { prefix: " ", text: "line3" },
    ]);
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

  it("rejects missing Begin Patch", () => {
    const result = parsePatch("*** Add File: x\n+content");
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

  it("rejects Move File", () => {
    const result = parsePatch(
      "*** Begin Patch\n*** Move File: a.txt to b.txt\n*** End Patch",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Move File is not supported");
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
      [
        { prefix: "-", text: "hello" },
        { prefix: "+", text: "goodbye" },
      ],
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toBe("goodbye");
  });

  it("does not match deleted text inside a line substring", () => {
    const result = applyHunks("hello world", [
      [
        { prefix: "-", text: "hello" },
        { prefix: "+", text: "goodbye" },
      ],
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("does not match");
  });

  it("applies replacement with context", () => {
    const result = applyHunks("line1\nline2\nline3", [
      [
        { prefix: " ", text: "line1" },
        { prefix: "-", text: "line2" },
        { prefix: "+", text: "modified" },
        { prefix: " ", text: "line3" },
      ],
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toBe("line1\nmodified\nline3");
  });

  it("applies multiple hunks", () => {
    const content = "aaa\nbbb\nccc\nbbb\nddd";
    const result = applyHunks(content, [
      [
        { prefix: "-", text: "bbb" },
        { prefix: "+", text: "BBB" },
      ],
      [
        { prefix: "-", text: "bbb" },
        { prefix: "+", text: "BBB" },
      ],
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toBe("aaa\nBBB\nccc\nBBB\nddd");
  });

  it("fails when context does not match", () => {
    const result = applyHunks("hello world", [
      [
        { prefix: "-", text: "goodbye" },
        { prefix: "+", text: "hello" },
      ],
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("does not match");
  });

  it("handles addition-only hunk", () => {
    const result = applyHunks("line1\nline3", [
      [
        { prefix: " ", text: "line1" },
        { prefix: "+", text: "line2" },
        { prefix: " ", text: "line3" },
      ],
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toBe("line1\nline2\nline3");
  });

  it("handles removal-only hunk", () => {
    const result = applyHunks("line1\nline2\nline3", [
      [
        { prefix: " ", text: "line1" },
        { prefix: "-", text: "line2" },
        { prefix: " ", text: "line3" },
      ],
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toBe("line1\nline3");
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

    // File unchanged
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
    expect(result.output).toContain("does not match");

    // File unchanged
    expect(await readFile(join(tmp, "app.ts"), "utf-8")).toBe("line1\nactual\nline3");

    await rm(tmp, { recursive: true });
  });

  it("failure does not partially write", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-patch-"));
    await writeFile(join(tmp, "existing.txt"), "keep this");
    const ctx = makeContext(tmp);

    // This patch: first op should succeed (add), second should fail (update with wrong context)
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

    // Neither file should be changed: new.txt not created, existing.txt unchanged
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
});

// --- Diff metadata ---

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
});
