import { describe, it, expect } from "vitest";
import { writeFileTool } from "../src/tools/write.js";
import { editFileTool } from "../src/tools/edit.js";
import { readFileTool } from "../src/tools/read.js";
import { ReadStateTracker } from "../src/tools/file-mutation.js";
import type { ToolContext } from "../src/tools/tool.js";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeContext(cwd: string, overrides: Partial<ToolContext> = {}): ToolContext {
  return { cwd, permissionResolved: false, ...overrides };
}

describe("write_file", () => {
  it("creates a new file", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-write-"));
    const ctx = makeContext(tmp);

    const result = await writeFileTool.execute(
      { path: "hello.txt", content: "hello world" },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Wrote hello.txt");

    const content = await readFile(join(tmp, "hello.txt"), "utf-8");
    expect(content).toBe("hello world");

    await rm(tmp, { recursive: true });
  });

  it("creates nested directories", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-write-"));
    const ctx = makeContext(tmp);

    const result = await writeFileTool.execute(
      { path: "src/utils/helper.ts", content: "export const x = 1;" },
      ctx,
    );
    expect(result.ok).toBe(true);

    const content = await readFile(join(tmp, "src", "utils", "helper.ts"), "utf-8");
    expect(content).toBe("export const x = 1;");

    await rm(tmp, { recursive: true });
  });

  it("rejects paths outside workspace", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-write-"));
    const ctx = makeContext(tmp);

    const result = await writeFileTool.execute(
      { path: "../outside.txt", content: "nope" },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.output).toContain("outside workspace");

    await rm(tmp, { recursive: true });
  });

  it("rejects existing file without prior read", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-write-"));
    await writeFile(join(tmp, "existing.txt"), "original");
    const readState = new ReadStateTracker();
    const ctx = makeContext(tmp, { readState });

    const result = await writeFileTool.execute(
      { path: "existing.txt", content: "overwritten" },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.output).toContain("must be read with read_file");

    const content = await readFile(join(tmp, "existing.txt"), "utf-8");
    expect(content).toBe("original");

    await rm(tmp, { recursive: true });
  });

  it("allows existing file after read_file", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-write-"));
    await writeFile(join(tmp, "data.txt"), "old content");
    const readState = new ReadStateTracker();
    const ctx = makeContext(tmp, { readState, permissionResolved: true });

    // Simulate read_file recording state
    const readResult = await readFileTool.execute(
      {
        path: "data.txt",
        resolvedPath: join(tmp, "data.txt"),
        realPath: join(tmp, "data.txt"),
      },
      ctx,
    );
    expect(readResult.ok).toBe(true);

    const writeResult = await writeFileTool.execute(
      { path: "data.txt", content: "new content" },
      ctx,
    );
    expect(writeResult.ok).toBe(true);
    expect(writeResult.output).toContain("Wrote data.txt");

    const content = await readFile(join(tmp, "data.txt"), "utf-8");
    expect(content).toBe("new content");

    await rm(tmp, { recursive: true });
  });

  it("rejects stale write after external modification", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-write-"));
    await writeFile(join(tmp, "data.txt"), "original");
    const readState = new ReadStateTracker();
    const ctx = makeContext(tmp, { readState, permissionResolved: true });

    // Read the file
    await readFileTool.execute(
      {
        path: "data.txt",
        resolvedPath: join(tmp, "data.txt"),
        realPath: join(tmp, "data.txt"),
      },
      ctx,
    );

    // External modification (simulated by writing with a delay)
    await new Promise((r) => setTimeout(r, 10));
    await writeFile(join(tmp, "data.txt"), "externally modified");

    // Write should be rejected due to stale state
    const writeResult = await writeFileTool.execute(
      { path: "data.txt", content: "new content" },
      ctx,
    );
    expect(writeResult.ok).toBe(false);
    expect(writeResult.output).toContain("modified since");

    await rm(tmp, { recursive: true });
  });

  it("includes diff info for existing file overwrite", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-write-"));
    await writeFile(join(tmp, "code.ts"), "line1\nline2\nline3\n");
    const readState = new ReadStateTracker();
    const ctx = makeContext(tmp, { readState, permissionResolved: true });

    await readFileTool.execute(
      {
        path: "code.ts",
        resolvedPath: join(tmp, "code.ts"),
        realPath: join(tmp, "code.ts"),
      },
      ctx,
    );

    const result = await writeFileTool.execute(
      { path: "code.ts", content: "line1\nmodified\nline3\n" },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain("additions");
    expect(result.output).toContain("deletions");

    await rm(tmp, { recursive: true });
  });
});

describe("edit_file enhanced", () => {
  it("rejects old_string === new_string", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-edit-"));
    await writeFile(join(tmp, "f.txt"), "hello");
    const ctx = makeContext(tmp, { permissionResolved: true });

    const result = await editFileTool.execute(
      {
        path: "f.txt",
        resolvedPath: join(tmp, "f.txt"),
        old_string: "hello",
        new_string: "hello",
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.output).toContain("identical");

    await rm(tmp, { recursive: true });
  });

  it("rejects empty old_string and suggests write_file", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-edit-"));
    await writeFile(join(tmp, "f.txt"), "hello");
    const ctx = makeContext(tmp, { permissionResolved: true });

    const result = await editFileTool.execute(
      {
        path: "f.txt",
        resolvedPath: join(tmp, "f.txt"),
        old_string: "",
        new_string: "hello",
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.output).toContain("write_file");

    await rm(tmp, { recursive: true });
  });

  it("rejects multiple matches without replace_all", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-edit-"));
    await writeFile(join(tmp, "f.txt"), "foo bar foo baz foo");
    const ctx = makeContext(tmp, { permissionResolved: true });

    const result = await editFileTool.execute(
      {
        path: "f.txt",
        resolvedPath: join(tmp, "f.txt"),
        old_string: "foo",
        new_string: "qux",
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.output).toContain("3 times");

    await rm(tmp, { recursive: true });
  });

  it("replaces all occurrences with replace_all", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-edit-"));
    await writeFile(join(tmp, "f.txt"), "foo bar foo baz foo");
    const ctx = makeContext(tmp, { permissionResolved: true });

    const result = await editFileTool.execute(
      {
        path: "f.txt",
        resolvedPath: join(tmp, "f.txt"),
        old_string: "foo",
        new_string: "qux",
        replace_all: true,
      },
      ctx,
    );
    expect(result.ok).toBe(true);

    const content = await readFile(join(tmp, "f.txt"), "utf-8");
    expect(content).toBe("qux bar qux baz qux");

    await rm(tmp, { recursive: true });
  });

  it("replace_all fails when no matches", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-edit-"));
    await writeFile(join(tmp, "f.txt"), "hello world");
    const ctx = makeContext(tmp, { permissionResolved: true });

    const result = await editFileTool.execute(
      {
        path: "f.txt",
        resolvedPath: join(tmp, "f.txt"),
        old_string: "xyz",
        new_string: "abc",
        replace_all: true,
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.output).toContain("not found");

    await rm(tmp, { recursive: true });
  });

  it("preserves CRLF line endings", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-edit-"));
    await writeFile(join(tmp, "crlf.txt"), "line1\r\nline2\r\nline3\r\n");
    const ctx = makeContext(tmp, { permissionResolved: true });

    const result = await editFileTool.execute(
      {
        path: "crlf.txt",
        resolvedPath: join(tmp, "crlf.txt"),
        old_string: "line2",
        new_string: "modified",
      },
      ctx,
    );
    expect(result.ok).toBe(true);

    const content = await readFile(join(tmp, "crlf.txt"), "utf-8");
    expect(content).toContain("\r\n");
    expect(content).not.toMatch(/(?<!\r)\n/);
    expect(content).toContain("modified");

    await rm(tmp, { recursive: true });
  });

  it("includes diff and stats in result", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-edit-"));
    await writeFile(join(tmp, "f.txt"), "hello\nworld\n");
    const ctx = makeContext(tmp, { permissionResolved: true });

    const result = await editFileTool.execute(
      {
        path: "f.txt",
        resolvedPath: join(tmp, "f.txt"),
        old_string: "world",
        new_string: "earth",
      },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain("additions");
    expect(result.output).toContain("deletions");
    expect(result.output).toContain("-world");
    expect(result.output).toContain("+earth");

    await rm(tmp, { recursive: true });
  });
});
