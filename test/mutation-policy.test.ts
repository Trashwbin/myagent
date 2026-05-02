import { describe, it, expect } from "vitest";
import {
  validateMutationPath,
  isMutationTool,
  getCheckpointPaths,
  buildWriteDiffMeta,
  buildEditDiffMeta,
  isSensitivePath,
  classifyWriteTarget,
} from "../src/tools/mutation-policy.js";
import { checkToolPermission } from "../src/permission/policy.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("validateMutationPath", () => {
  it("accepts a valid workspace path", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-mp-"));
    const result = validateMutationPath("test.txt", tmp);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pathInfo.insideWorkspace).toBe(true);
    await rm(tmp, { recursive: true });
  });

  it("rejects unresolvable path", () => {
    const result = validateMutationPath("/etc/passwd", "/workspace");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("cannot be resolved");
  });

  it("rejects path escaping workspace", () => {
    const result = validateMutationPath("../../../etc/passwd", "/workspace/project");
    expect(result.ok).toBe(false);
  });
});

describe("isMutationTool", () => {
  it("identifies mutation tools", () => {
    expect(isMutationTool("edit_file")).toBe(true);
    expect(isMutationTool("write_file")).toBe(true);
    expect(isMutationTool("apply_patch")).toBe(true);
  });

  it("rejects non-mutation tools", () => {
    expect(isMutationTool("Read")).toBe(false);
    expect(isMutationTool("bash")).toBe(false);
    expect(isMutationTool("grep")).toBe(false);
    expect(isMutationTool("list_dir")).toBe(false);
    expect(isMutationTool("glob")).toBe(false);
  });
});

describe("getCheckpointPaths", () => {
  it("extracts single path from edit_file", () => {
    const paths = getCheckpointPaths("edit_file", {
      resolvedPath: "/ws/app.ts",
      path: "app.ts",
    });
    expect(paths).toEqual(["/ws/app.ts"]);
  });

  it("falls back to path when resolvedPath is absent", () => {
    const paths = getCheckpointPaths("edit_file", { path: "app.ts" });
    expect(paths).toEqual(["app.ts"]);
  });

  it("extracts single path from write_file", () => {
    const paths = getCheckpointPaths("write_file", {
      resolvedPath: "/ws/new.ts",
      path: "new.ts",
    });
    expect(paths).toEqual(["/ws/new.ts"]);
  });

  it("extracts multiple paths from apply_patch", () => {
    const paths = getCheckpointPaths("apply_patch", {
      resolvedPaths: { "a.ts": "/ws/a.ts", "b.ts": "/ws/b.ts" },
    });
    expect(paths.sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("returns empty for apply_patch without resolvedPaths", () => {
    const paths = getCheckpointPaths("apply_patch", {});
    expect(paths).toEqual([]);
  });

  it("returns empty for non-mutation tool", () => {
    const paths = getCheckpointPaths("read_file", { path: "x.ts" });
    expect(paths).toEqual([]);
  });
});

describe("isSensitivePath", () => {
  it("detects .env as sensitive", () => {
    expect(isSensitivePath("/workspace/.env")).toBe(true);
  });

  it("allows regular files", () => {
    expect(isSensitivePath("/workspace/app.ts")).toBe(false);
  });
});

describe("buildWriteDiffMeta", () => {
  it("reports create for new file", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-mp-"));
    const meta = buildWriteDiffMeta(join(tmp, "new.txt"), "new.txt", "content");
    expect(meta.operation).toBe("create");
    expect(meta.additions).toBe(1);
    expect(meta.deletions).toBe(0);
    await rm(tmp, { recursive: true });
  });

  it("reports write for existing file", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-mp-"));
    await writeFile(join(tmp, "app.ts"), "old\n");
    const meta = buildWriteDiffMeta(join(tmp, "app.ts"), "app.ts", "new\n");
    expect(meta.operation).toBe("write");
    expect(meta.additions).toBe(1);
    expect(meta.deletions).toBe(1);
    await rm(tmp, { recursive: true });
  });

  it("returns directory operation for directory target", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-mp-"));
    const { mkdir: mkdirAsync } = await import("node:fs/promises");
    await mkdirAsync(join(tmp, "subdir"));
    const meta = buildWriteDiffMeta(join(tmp, "subdir"), "subdir", "content");
    expect(meta.operation).toBe("directory");
    expect(meta.diff).toBeUndefined();
    await rm(tmp, { recursive: true });
  });
});

describe("classifyWriteTarget", () => {
  it("returns absent for nonexistent path", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-mp-"));
    expect(classifyWriteTarget(join(tmp, "nope.txt"))).toBe("absent");
    await rm(tmp, { recursive: true });
  });

  it("returns file for regular file", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-mp-"));
    await writeFile(join(tmp, "f.txt"), "x");
    expect(classifyWriteTarget(join(tmp, "f.txt"))).toBe("file");
    await rm(tmp, { recursive: true });
  });

  it("returns directory for directory", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-mp-"));
    expect(classifyWriteTarget(tmp)).toBe("directory");
    await rm(tmp, { recursive: true });
  });
});

describe("buildEditDiffMeta", () => {
  it("computes edit diff for matching old_string", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-mp-"));
    await writeFile(join(tmp, "app.ts"), "hello\nworld\n");
    const meta = buildEditDiffMeta(
      join(tmp, "app.ts"),
      "app.ts",
      "hello",
      "hi",
      false,
    );
    expect(meta.operation).toBe("edit");
    expect(meta.additions).toBe(1);
    expect(meta.deletions).toBe(1);
    await rm(tmp, { recursive: true });
  });

  it("returns matchCount=0 when string not found", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-mp-"));
    await writeFile(join(tmp, "app.ts"), "hello\n");
    const meta = buildEditDiffMeta(
      join(tmp, "app.ts"),
      "app.ts",
      "missing",
      "replacement",
      false,
    );
    expect(meta.operation).toBe("edit");
    expect(meta.matchCount).toBe(0);
    await rm(tmp, { recursive: true });
  });

  it("returns bare operation for missing file", async () => {
    const meta = buildEditDiffMeta(
      "/nonexistent/path.ts",
      "path.ts",
      "old",
      "new",
      false,
    );
    expect(meta.operation).toBe("edit");
    expect(meta.diff).toBeUndefined();
  });
});

describe("mutation tools metadata shape consistency", () => {
  it("edit_file metadata has operation field", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-mp-"));
    await writeFile(join(tmp, "app.ts"), "hello\n");

    const decision = checkToolPermission(
      "edit_file",
      { path: "app.ts", old_string: "hello", new_string: "world" },
      "auto",
      tmp,
    );
    expect(decision.behavior).toBe("ask");
    expect(decision.metadata?.operation).toBe("edit");
    expect(decision.metadata?.diff).toBeDefined();

    await rm(tmp, { recursive: true });
  });

  it("write_file metadata has operation field", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-mp-"));

    const decision = checkToolPermission(
      "write_file",
      { path: "new.txt", content: "hello" },
      "auto",
      tmp,
    );
    expect(decision.behavior).toBe("ask");
    expect(decision.metadata?.operation).toBe("create");
    expect(decision.metadata?.additions).toBeDefined();

    await rm(tmp, { recursive: true });
  });

  it("write_file denies directory target", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-mp-"));
    const { mkdir: mkdirAsync } = await import("node:fs/promises");
    await mkdirAsync(join(tmp, "subdir"));

    const decision = checkToolPermission(
      "write_file",
      { path: "subdir", content: "hello" },
      "auto",
      tmp,
    );
    expect(decision.behavior).toBe("deny");
    expect(decision.reason).toContain("directory");

    await rm(tmp, { recursive: true });
  });

  it("apply_patch metadata has operation field", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-mp-"));

    const patch = `*** Begin Patch
*** Add File: new.txt
+content
*** End Patch`;

    const decision = checkToolPermission("apply_patch", { patch }, "auto", tmp);
    expect(decision.behavior).toBe("ask");
    expect(decision.metadata?.operation).toBe("patch");
    expect(decision.metadata?.affectedPaths).toEqual(["new.txt"]);

    await rm(tmp, { recursive: true });
  });

  it("all mutation tools deny in never mode", () => {
    const d1 = checkToolPermission(
      "edit_file",
      { path: "f.ts", old_string: "a", new_string: "b" },
      "never",
      "/ws",
    );
    const d2 = checkToolPermission(
      "write_file",
      { path: "f.ts", content: "x" },
      "never",
      "/ws",
    );
    const d3 = checkToolPermission(
      "apply_patch",
      { patch: "*** Begin Patch\n*** Add File: f\n+x\n*** End Patch" },
      "never",
      "/ws",
    );
    expect(d1.behavior).toBe("deny");
    expect(d2.behavior).toBe("deny");
    expect(d3.behavior).toBe("deny");
  });

  it("sensitive edit_file metadata does not leak diff", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-mp-"));
    await writeFile(join(tmp, ".env"), "TOKEN=secret\n");

    const decision = checkToolPermission(
      "edit_file",
      { path: ".env", old_string: "TOKEN=secret", new_string: "TOKEN=new" },
      "auto",
      tmp,
    );
    expect(decision.behavior).toBe("ask");
    expect(decision.metadata?.sensitive).toBe(true);
    expect(decision.metadata?.diff).toBeUndefined();
    expect(JSON.stringify(decision.metadata)).not.toContain("TOKEN");

    await rm(tmp, { recursive: true });
  });

  it("sensitive write_file metadata does not leak diff", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-mp-"));
    await writeFile(join(tmp, ".env"), "TOKEN=secret\n");

    const decision = checkToolPermission(
      "write_file",
      { path: ".env", content: "TOKEN=new" },
      "auto",
      tmp,
    );
    expect(decision.behavior).toBe("ask");
    expect(decision.metadata?.sensitive).toBe(true);
    expect(decision.metadata?.diff).toBeUndefined();

    await rm(tmp, { recursive: true });
  });

  it("edit_file does not require read-before-write", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-mp-"));
    await writeFile(join(tmp, "app.ts"), "hello\n");

    // No read_state — edit should still work (not gated by read-before-write)
    const decision = checkToolPermission(
      "edit_file",
      { path: "app.ts", old_string: "hello", new_string: "world" },
      "auto",
      tmp,
    );
    // edit_file should ask for approval (not deny due to missing read state)
    expect(decision.behavior).toBe("ask");

    await rm(tmp, { recursive: true });
  });
});
