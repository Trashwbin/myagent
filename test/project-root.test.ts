import { describe, expect, it, afterEach } from "vitest";
import { findProjectRoot } from "../src/workspace/project-root.js";
import { mkdtemp, writeFile, mkdir, symlink, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("findProjectRoot", () => {
  let tmpDirs: string[] = [];

  afterEach(async () => {
    for (const d of tmpDirs) await rm(d, { recursive: true, force: true });
    tmpDirs = [];
  });

  async function tmp(): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), "myagent-proot-"));
    tmpDirs.push(d);
    return d;
  }

  it("finds project root from nested source file", async () => {
    const root = await tmp();
    await mkdir(join(root, "src", "session"), { recursive: true });
    await writeFile(join(root, "package.json"), "{}");
    await writeFile(join(root, "src", "session", "loop.ts"), "export {}");

    const result = findProjectRoot(join(root, "src", "session", "loop.ts"));
    expect(result.root).toBe(realpathSync(root));
    expect(result.reason).toBe("project_root");
  });

  it("finds nearest package root with nested markers", async () => {
    const outer = await tmp();
    const inner = join(outer, "packages", "lib");
    await mkdir(join(inner, "src"), { recursive: true });
    await writeFile(join(outer, "package.json"), '{"name":"monorepo"}');
    await writeFile(join(inner, "package.json"), '{"name":"lib"}');
    await writeFile(join(inner, "src", "index.ts"), "export {}");

    const result = findProjectRoot(join(inner, "src", "index.ts"));
    expect(result.root).toBe(realpathSync(inner));
    expect(result.reason).toBe("project_root");
  });

  it("returns parent directory when no marker found", async () => {
    const root = await tmp();
    await mkdir(join(root, "subdir"), { recursive: true });

    const result = findProjectRoot(join(root, "subdir", "file.txt"));
    expect(result.root).toBe(realpathSync(root) + "/subdir");
    expect(result.reason).toBe("parent_directory");
  });

  it("resolves symlinks to canonical paths", async () => {
    const root = await tmp();
    const linkTarget = await tmp();
    await mkdir(join(linkTarget, "src"), { recursive: true });
    await writeFile(join(linkTarget, "package.json"), "{}");
    await writeFile(join(linkTarget, "src", "index.ts"), "export {}");
    await symlink(linkTarget, join(root, "linked-project"));

    const canonicalTarget = realpathSync(linkTarget);
    const result = findProjectRoot(join(root, "linked-project", "src", "index.ts"));
    expect(result.root).toBe(canonicalTarget);
    expect(result.reason).toBe("project_root");
  });

  it("finds .git as project marker", async () => {
    const root = await tmp();
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, ".git"));

    const result = findProjectRoot(join(root, "src", "main.go"));
    expect(result.root).toBe(realpathSync(root));
    expect(result.reason).toBe("project_root");
  });

  it("finds go.mod as project marker", async () => {
    const root = await tmp();
    await mkdir(join(root, "cmd"), { recursive: true });
    await writeFile(join(root, "go.mod"), "module example\n");

    const result = findProjectRoot(join(root, "cmd", "main.go"));
    expect(result.root).toBe(realpathSync(root));
    expect(result.reason).toBe("project_root");
  });

  it("treats non-existent path as directory when isDirectory=true", async () => {
    const root = await tmp();
    const nonExistentDir = join(root, "nonexistent");

    const result = findProjectRoot(nonExistentDir, true);
    expect(result.root).toBe(realpathSync(root) + "/nonexistent");
    expect(result.reason).toBe("parent_directory");
  });

  it("treats non-existent path as file when isDirectory=false", async () => {
    const root = await tmp();
    const nonExistentFile = join(root, "nonexistent", "file.txt");

    const result = findProjectRoot(nonExistentFile, false);
    expect(result.root).toBe(realpathSync(root) + "/nonexistent");
    expect(result.reason).toBe("parent_directory");
  });
});
