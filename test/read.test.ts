import { describe, expect, it } from "vitest";
import { readFileTool } from "../src/tools/read.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Read tool", () => {
  it("returns content with line numbers", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-read-"));
    await writeFile(join(tmp, "app.ts"), "line one\nline two\nline three\n");

    const result = await readFileTool.execute(
      { path: "app.ts" },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("1: line one");
    expect(result.output).toContain("2: line two");
    expect(result.output).toContain("3: line three");

    await rm(tmp, { recursive: true, force: true });
  });

  it("respects offset parameter (1-indexed)", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-read-"));
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
    await writeFile(join(tmp, "ten.txt"), lines.join("\n"));

    const result = await readFileTool.execute(
      { path: "ten.txt", offset: 5, limit: 3 },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("5: line 5");
    expect(result.output).toContain("6: line 6");
    expect(result.output).toContain("7: line 7");
    expect(result.output).not.toContain("4: line 4");
    expect(result.output).not.toContain("8: line 8");

    await rm(tmp, { recursive: true, force: true });
  });

  it("respects limit parameter", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-read-"));
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    await writeFile(join(tmp, "big.txt"), lines.join("\n"));

    const result = await readFileTool.execute(
      { path: "big.txt", limit: 5 },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("1: line 1");
    expect(result.output).toContain("5: line 5");
    expect(result.output).not.toContain("6: line 6");

    await rm(tmp, { recursive: true, force: true });
  });

  it("shows continuation hint when file has more lines", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-read-"));
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    await writeFile(join(tmp, "cont.txt"), lines.join("\n"));

    const result = await readFileTool.execute(
      { path: "cont.txt", limit: 10 },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("File has 20 total lines");
    expect(result.output).toContain("offset=11");

    await rm(tmp, { recursive: true, force: true });
  });

  it("no hint when entire file is read", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-read-"));
    await writeFile(join(tmp, "small.txt"), "only line\n");

    const result = await readFileTool.execute(
      { path: "small.txt" },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toBe("1: only line");
    expect(result.output).not.toContain("total lines");

    await rm(tmp, { recursive: true, force: true });
  });

  it("truncates long lines", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-read-"));
    const longLine = "x".repeat(3000);
    await writeFile(join(tmp, "long.txt"), longLine);

    const result = await readFileTool.execute(
      { path: "long.txt" },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("…");
    expect(result.output.length).toBeLessThan(2100);

    await rm(tmp, { recursive: true, force: true });
  });

  it("handles offset past end of file", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-read-"));
    await writeFile(join(tmp, "short.txt"), "only line\n");

    const result = await readFileTool.execute(
      { path: "short.txt", offset: 10 },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("offset=10 is past end of file");

    await rm(tmp, { recursive: true, force: true });
  });

  it("records partial read state when offset or limit is used", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-read-"));
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
    await writeFile(join(tmp, "state.txt"), lines.join("\n"));

    const { ReadStateTracker } = await import("../src/tools/file-mutation.js");
    const readState = new ReadStateTracker();

    const { realpathSync } = await import("node:fs");
    const realPath = realpathSync.native(join(tmp, "state.txt"));

    await readFileTool.execute(
      { path: "state.txt", offset: 1, limit: 5 },
      { cwd: tmp, readState },
    );

    const state = readState.get(realPath);
    expect(state).toBeDefined();
    expect(state!.partial).toBe(true);

    await rm(tmp, { recursive: true, force: true });
  });

  it("records full read state when entire file is read", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-read-"));
    await writeFile(join(tmp, "full.txt"), "line one\nline two\n");

    const { ReadStateTracker } = await import("../src/tools/file-mutation.js");
    const readState = new ReadStateTracker();

    const { realpathSync } = await import("node:fs");
    const realPath = realpathSync.native(join(tmp, "full.txt"));

    await readFileTool.execute(
      { path: "full.txt" },
      { cwd: tmp, readState },
    );

    const state = readState.get(realPath);
    expect(state).toBeDefined();
    expect(state!.partial).toBe(false);

    await rm(tmp, { recursive: true, force: true });
  });

  it("returns error for nonexistent file", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-read-"));

    const result = await readFileTool.execute(
      { path: "nope.txt" },
      { cwd: tmp },
    );

    expect(result.ok).toBe(false);
    expect(result.output).toContain("Failed to read file");

    await rm(tmp, { recursive: true, force: true });
  });

  it("rejects external path without permission-resolved input", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-read-"));
    const sibling = `${tmp}-sibling`;
    const { mkdir } = await import("node:fs/promises");
    await mkdir(sibling);
    await writeFile(join(sibling, "ext.txt"), "ext content");

    const result = await readFileTool.execute(
      { path: `../${sibling.split("/").at(-1)}/ext.txt` },
      { cwd: tmp },
    );

    expect(result.ok).toBe(false);
    expect(result.output).toContain("permission-resolved input");

    await rm(tmp, { recursive: true, force: true });
    await rm(sibling, { recursive: true, force: true });
  });
});
