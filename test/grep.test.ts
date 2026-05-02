import { describe, expect, it } from "vitest";
import { searchTool } from "../src/tools/search.js";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("grep tool", () => {
  it("returns file path, line number, and matched text", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-grep-"));
    await writeFile(
      join(tmp, "app.ts"),
      "function hello() {\n  return 'world';\n}\n",
    );

    const result = await searchTool.execute(
      { pattern: "hello", path: "." },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("app.ts");
    expect(result.output).toContain("function hello()");

    await rm(tmp, { recursive: true, force: true });
  });

  it("returns no matches message when pattern not found", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-grep-"));
    await writeFile(join(tmp, "a.txt"), "hello world");

    const result = await searchTool.execute(
      { pattern: "nonexistent_pattern_xyz" },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("No matches found");

    await rm(tmp, { recursive: true, force: true });
  });

  it("respects max_results", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-grep-"));
    const lines = Array.from({ length: 20 }, (_, i) => `match line ${i}`);
    await writeFile(join(tmp, "many.txt"), lines.join("\n"));

    const result = await searchTool.execute(
      { pattern: "match", max_results: 3 },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("match line 0");
    expect(result.output).toContain("truncated");

    await rm(tmp, { recursive: true, force: true });
  });

  it("respects before_context and after_context", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-grep-"));
    await writeFile(
      join(tmp, "ctx.txt"),
      "line 1\nline 2\nTARGET\nline 4\nline 5\n",
    );

    const result = await searchTool.execute(
      { pattern: "TARGET", before_context: 1, after_context: 1 },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("TARGET");
    // Context lines should appear in output
    expect(result.output.split("\n").length).toBeGreaterThanOrEqual(3);

    await rm(tmp, { recursive: true, force: true });
  });

  it("respects include parameter", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-grep-"));
    await writeFile(join(tmp, "a.ts"), "const x = FINDME;");
    await writeFile(join(tmp, "b.md"), "# FINDME heading");

    const result = await searchTool.execute(
      { pattern: "FINDME", include: "*.ts" },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("a.ts");
    expect(result.output).not.toContain("b.md");

    await rm(tmp, { recursive: true, force: true });
  });

  it("searches subdirectories", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-grep-"));
    await mkdir(join(tmp, "src"));
    await writeFile(join(tmp, "src", "deep.ts"), "NEEDLE_IN_DIR");

    const result = await searchTool.execute(
      { pattern: "NEEDLE_IN_DIR", path: "." },
      { cwd: tmp },
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("NEEDLE_IN_DIR");

    await rm(tmp, { recursive: true, force: true });
  });
});
