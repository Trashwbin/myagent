import { describe, expect, it } from "vitest";
import { globTool } from "../src/tools/glob.js";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("glob tool", () => {
  it("finds files matching a pattern", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-glob-"));
    await writeFile(join(tmp, "app.ts"), "");
    await writeFile(join(tmp, "app.test.ts"), "");
    await writeFile(join(tmp, "readme.md"), "");

    const result = await globTool.execute(
      { pattern: "*.ts", path: "." },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("app.ts");
    expect(result.output).toContain("app.test.ts");
    expect(result.output).not.toContain("readme.md");

    await rm(tmp, { recursive: true, force: true });
  });

  it("finds files in subdirectories", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-glob-"));
    await mkdir(join(tmp, "src"));
    await writeFile(join(tmp, "src", "util.ts"), "");

    const result = await globTool.execute(
      { pattern: "*.ts", path: "." },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("util.ts");

    await rm(tmp, { recursive: true, force: true });
  });

  it("respects limit parameter", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-glob-"));
    for (let i = 1; i <= 20; i++) {
      await writeFile(join(tmp, `file${i}.txt`), "");
    }

    const result = await globTool.execute(
      { pattern: "*.txt", path: ".", limit: 5 },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("truncated");

    await rm(tmp, { recursive: true, force: true });
  });

  it("returns no files found when no matches", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-glob-"));
    await writeFile(join(tmp, "readme.md"), "");

    const result = await globTool.execute(
      { pattern: "*.rs", path: "." },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("No files found");

    await rm(tmp, { recursive: true, force: true });
  });

  it("returns error when path is not a directory", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-glob-"));
    await writeFile(join(tmp, "file.txt"), "content");

    const result = await globTool.execute(
      { pattern: "*.ts", path: "file.txt" },
      { cwd: tmp },
    );

    expect(result.ok).toBe(false);
    expect(result.output).toContain("must be a directory");

    await rm(tmp, { recursive: true, force: true });
  });

  it("returns error for nonexistent path", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-glob-"));

    const result = await globTool.execute(
      { pattern: "*.ts", path: "nonexistent" },
      { cwd: tmp },
    );

    expect(result.ok).toBe(false);
    expect(result.output).toContain("does not exist");

    await rm(tmp, { recursive: true, force: true });
  });

  it("rejects external path without permission-resolved input", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-glob-"));
    const sibling = `${tmp}-sibling`;
    await mkdir(sibling);

    const result = await globTool.execute(
      { pattern: "*.ts", path: `../${sibling.split("/").at(-1)}` },
      { cwd: tmp },
    );

    expect(result.ok).toBe(false);
    expect(result.output).toContain("permission-resolved input");

    await rm(tmp, { recursive: true, force: true });
    await rm(sibling, { recursive: true, force: true });
  });

  it("finds files by exact name", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-glob-"));
    await mkdir(join(tmp, "src"));
    await writeFile(join(tmp, "package.json"), "{}");
    await writeFile(join(tmp, "src", "package.json"), "{}");
    await writeFile(join(tmp, "other.txt"), "");

    const result = await globTool.execute(
      { pattern: "package.json", path: "." },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("package.json");
    expect(result.output).not.toContain("other.txt");

    await rm(tmp, { recursive: true, force: true });
  });

  it("finds hidden config files", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-glob-"));
    await writeFile(join(tmp, ".gitignore"), "node_modules\n");
    await writeFile(join(tmp, ".prettierrc"), "{}");
    await writeFile(join(tmp, "app.ts"), "");

    const result = await globTool.execute(
      { pattern: ".gitignore", path: "." },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain(".gitignore");

    const all = await globTool.execute(
      { pattern: ".*", path: "." },
      { cwd: tmp },
    );

    expect(all.ok).toBe(true);
    expect(all.output).toContain(".gitignore");
    expect(all.output).toContain(".prettierrc");

    await rm(tmp, { recursive: true, force: true });
  });
});
