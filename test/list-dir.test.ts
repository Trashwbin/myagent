import { describe, expect, it } from "vitest";
import { listDirTool } from "../src/tools/list-dir.js";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("list_dir", () => {
  it("lists directory contents with file and dir indicators", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-listdir-"));
    await writeFile(join(tmp, "file.txt"), "hi");
    await mkdir(join(tmp, "subdir"));

    const result = await listDirTool.execute({ path: "." }, { cwd: tmp });

    expect(result.ok).toBe(true);
    expect(result.output).toContain("file.txt");
    expect(result.output).toContain("subdir/");
    expect(result.output).toContain(tmp);

    await rm(tmp, { recursive: true, force: true });
  });

  it("sorts entries", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-listdir-"));
    await writeFile(join(tmp, "zebra.txt"), "z");
    await writeFile(join(tmp, "alpha.txt"), "a");
    await mkdir(join(tmp, "middle"));

    const result = await listDirTool.execute({ path: "." }, { cwd: tmp });

    expect(result.ok).toBe(true);
    const lines = result.output.split("\n").slice(1);
    expect(lines[0]).toBe("alpha.txt");
    expect(lines[1]).toBe("middle/");
    expect(lines[2]).toBe("zebra.txt");

    await rm(tmp, { recursive: true, force: true });
  });

  it("respects offset and limit", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-listdir-"));
    for (let i = 1; i <= 5; i++) {
      await writeFile(join(tmp, `file${i}.txt`), `${i}`);
    }

    const result = await listDirTool.execute(
      { path: ".", offset: 2, limit: 2 },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    const lines = result.output.split("\n").slice(1);
    expect(lines).toEqual(["file2.txt", "file3.txt"]);

    await rm(tmp, { recursive: true, force: true });
  });

  it("rejects external path without permission-resolved input", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-listdir-"));
    const sibling = `${tmp}-sibling`;
    await mkdir(sibling);

    const result = await listDirTool.execute(
      { path: `../${sibling.split("/").at(-1)}` },
      { cwd: tmp },
    );

    expect(result.ok).toBe(false);
    expect(result.output).toContain("permission-resolved input");

    await rm(tmp, { recursive: true, force: true });
    await rm(sibling, { recursive: true, force: true });
  });

  it("allows workspace directory without permission-resolved input", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-listdir-"));
    await mkdir(join(tmp, "src"));
    await writeFile(join(tmp, "src", "a.ts"), "");

    const result = await listDirTool.execute({ path: "src" }, { cwd: tmp });

    expect(result.ok).toBe(true);
    expect(result.output).toContain("a.ts");

    await rm(tmp, { recursive: true, force: true });
  });

  it("returns error for nonexistent directory", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-listdir-"));

    const result = await listDirTool.execute({ path: "nonexistent" }, { cwd: tmp });

    expect(result.ok).toBe(false);
    expect(result.output).toContain("Failed to list directory");

    await rm(tmp, { recursive: true, force: true });
  });
});
