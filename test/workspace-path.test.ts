import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileTool } from "../src/tools/read.js";
import { editFileTool } from "../src/tools/edit.js";
import { createCheckpoint } from "../src/workspace/checkpoint.js";

describe("workspace path safety", () => {
  it("rejects sibling directories with the same path prefix", async () => {
    const root = await mkdtemp(join(tmpdir(), "myagent-workspace-"));
    const sibling = `${root}-sibling`;
    await mkdir(sibling);
    await writeFile(join(sibling, "secret.txt"), "secret");

    const result = await readFileTool.execute(
      { path: `../${sibling.split("/").at(-1)}/secret.txt` },
      { cwd: root },
    );

    expect(result.ok).toBe(false);
    expect(result.output).toContain("outside workspace");

    await rm(root, { recursive: true, force: true });
    await rm(sibling, { recursive: true, force: true });
  });

  it("does not edit files outside the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "myagent-workspace-"));
    const sibling = `${root}-sibling`;
    await mkdir(sibling);
    const target = join(sibling, "secret.txt");
    await writeFile(target, "secret");

    const result = await editFileTool.execute(
      {
        path: `../${sibling.split("/").at(-1)}/secret.txt`,
        old_string: "secret",
        new_string: "changed",
      },
      { cwd: root },
    );

    expect(result.ok).toBe(false);
    expect(await readFile(target, "utf-8")).toBe("secret");

    await rm(root, { recursive: true, force: true });
    await rm(sibling, { recursive: true, force: true });
  });

  it("rejects symlinks that point outside the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "myagent-workspace-"));
    const outside = await mkdtemp(join(tmpdir(), "myagent-outside-"));
    const target = join(outside, "secret.txt");
    await writeFile(target, "secret");
    await symlink(outside, join(root, "outside"));

    const result = await readFileTool.execute(
      { path: "outside/secret.txt" },
      { cwd: root },
    );

    expect(result.ok).toBe(false);
    expect(result.output).toContain("outside workspace");

    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("does not edit through symlinks that point outside the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "myagent-workspace-"));
    const outside = await mkdtemp(join(tmpdir(), "myagent-outside-"));
    const target = join(outside, "secret.txt");
    await writeFile(target, "secret");
    await symlink(outside, join(root, "outside"));

    const result = await editFileTool.execute(
      {
        path: "outside/secret.txt",
        old_string: "secret",
        new_string: "changed",
      },
      { cwd: root },
    );

    expect(result.ok).toBe(false);
    expect(await readFile(target, "utf-8")).toBe("secret");

    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("does not checkpoint new files through symlinked outside directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "myagent-workspace-"));
    const outside = await mkdtemp(join(tmpdir(), "myagent-outside-"));
    await symlink(outside, join(root, "outside"));

    await expect(createCheckpoint(root, ["outside/new.txt"])).rejects.toThrow(
      "outside workspace",
    );

    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
});
