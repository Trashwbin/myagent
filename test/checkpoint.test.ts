import { describe, it, expect } from "vitest";
import { createCheckpoint, restoreCheckpoint } from "../src/workspace/checkpoint.js";
import { getCheckpointStorePaths, workspaceHash } from "../src/workspace/checkpoint-store.js";
import { mkdir, mkdtemp, writeFile, readFile, rm, chmod, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";

describe("checkpoint", () => {
  it("saves original file content", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-cp-"));
    await writeFile(join(tmp, "a.txt"), "original");

    const cp = await createCheckpoint(tmp, ["a.txt"]);
    expect(cp.files).toHaveLength(1);
    expect(cp.files[0].existed).toBe(true);

    // Modify file after checkpoint
    await writeFile(join(tmp, "a.txt"), "modified");

    await restoreCheckpoint(tmp, cp.id);

    const content = await readFile(join(tmp, "a.txt"), "utf-8");
    expect(content).toBe("original");

    await rm(tmp, { recursive: true });
  });

  it("deletes file that did not exist at checkpoint time", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-cp-"));

    const cp = await createCheckpoint(tmp, ["new.txt"]);
    expect(cp.files).toHaveLength(1);
    expect(cp.files[0].existed).toBe(false);

    // Create file after checkpoint
    await writeFile(join(tmp, "new.txt"), "new content");

    await restoreCheckpoint(tmp, cp.id);

    expect(existsSync(join(tmp, "new.txt"))).toBe(false);

    await rm(tmp, { recursive: true });
  });

  it("rejects paths outside workspace", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-cp-"));

    await expect(createCheckpoint(tmp, ["../etc/passwd"])).rejects.toThrow(
      "outside workspace",
    );

    await rm(tmp, { recursive: true });
  });

  it("handles nested file paths", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-cp-"));
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(tmp, "src"));
    await writeFile(join(tmp, "src", "index.ts"), "export {};");

    const cp = await createCheckpoint(tmp, ["src/index.ts"]);

    await writeFile(join(tmp, "src", "index.ts"), "changed");

    await restoreCheckpoint(tmp, cp.id);

    const content = await readFile(join(tmp, "src", "index.ts"), "utf-8");
    expect(content).toBe("export {};");

    await rm(tmp, { recursive: true });
  });

  it("restores multiple files including deleted files", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-cp-"));
    await writeFile(join(tmp, "keep.txt"), "before");
    await writeFile(join(tmp, "delete.txt"), "present");

    const cp = await createCheckpoint(tmp, ["keep.txt", "delete.txt"]);
    await writeFile(join(tmp, "keep.txt"), "after");
    await rm(join(tmp, "delete.txt"));

    await restoreCheckpoint(tmp, cp.id);

    expect(await readFile(join(tmp, "keep.txt"), "utf-8")).toBe("before");
    expect(await readFile(join(tmp, "delete.txt"), "utf-8")).toBe("present");
    await rm(tmp, { recursive: true });
  });

  it("writes shadow metadata outside the workspace", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-cp-"));
    await writeFile(join(tmp, "a.txt"), "content");

    const cp = await createCheckpoint(tmp, ["a.txt"]);
    expect(cp.id).toBeTruthy();
    expect(cp.createdAt).toBeTruthy();
    expect(cp.cwd).toBe(tmp);
    expect(cp.backend).toBe("shadow-git");
    expect(cp.version).toBe(2);
    expect(cp.workspaceHash).toBeTruthy();
    expect(cp.treeHash).toBeTruthy();
    expect(cp.commitHash).toBeTruthy();
    expect(cp.files[0].blobHash).toBeTruthy();

    expect(existsSync(join(tmp, ".myagent", "checkpoints"))).toBe(false);
    const storePaths = getCheckpointStorePaths(tmp);
    const metadata = await readFile(
      join(storePaths.metadataDir, `${cp.id}.json`),
      "utf-8",
    );
    const parsed = JSON.parse(metadata);
    expect(parsed.id).toBe(cp.id);
    expect(parsed.backend).toBe("shadow-git");

    await rm(tmp, { recursive: true });
  });

  it("restores binary files from shadow git blobs", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-cp-"));
    const target = join(tmp, "bin.dat");
    await writeFile(target, Buffer.from([0, 1, 2, 255]));

    const cp = await createCheckpoint(tmp, ["bin.dat"]);
    await writeFile(target, Buffer.from([9, 9, 9]));

    await restoreCheckpoint(tmp, cp.id);

    expect(await readFile(target)).toEqual(Buffer.from([0, 1, 2, 255]));
    await rm(tmp, { recursive: true });
  });

  it("preserves executable mode in metadata and on restore", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-cp-"));
    const target = join(tmp, "run.sh");
    await writeFile(target, "#!/bin/sh\n");
    await chmod(target, 0o755);

    const cp = await createCheckpoint(tmp, ["run.sh"]);
    await chmod(target, 0o644);
    await writeFile(target, "changed\n");
    await restoreCheckpoint(tmp, cp.id);

    expect(cp.files[0].mode).toBe("100755");
    expect((await stat(target)).mode & 0o111).not.toBe(0);
    await rm(tmp, { recursive: true });
  });

  it("links shadow checkpoint commits with parent metadata", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-cp-"));
    await writeFile(join(tmp, "a.txt"), "one");
    const first = await createCheckpoint(tmp, ["a.txt"]);
    await writeFile(join(tmp, "a.txt"), "two");
    const second = await createCheckpoint(tmp, ["a.txt"]);

    expect(first.parentCommitHash).toBeUndefined();
    expect(second.parentCommitHash).toBe(first.commitHash);
    await rm(tmp, { recursive: true });
  });

  it("restores legacy copy-v1 checkpoints", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-cp-"));
    await writeFile(join(tmp, "a.txt"), "legacy");
    const original = process.env.MYAGENT_CHECKPOINT_BACKEND;
    process.env.MYAGENT_CHECKPOINT_BACKEND = "copy-v1";

    try {
      const cp = await createCheckpoint(tmp, ["a.txt"]);
      expect(cp.backend).toBeUndefined();
      await writeFile(join(tmp, "a.txt"), "changed");

      await restoreCheckpoint(tmp, cp.id);

      expect(await readFile(join(tmp, "a.txt"), "utf-8")).toBe("legacy");
    } finally {
      if (original === undefined) {
        delete process.env.MYAGENT_CHECKPOINT_BACKEND;
      } else {
        process.env.MYAGENT_CHECKPOINT_BACKEND = original;
      }
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("checkpoints ignored files when explicitly requested", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-cp-"));
    await writeFile(join(tmp, ".gitignore"), "ignored.txt\n");
    await writeFile(join(tmp, "ignored.txt"), "ignored-before");

    const cp = await createCheckpoint(tmp, ["ignored.txt"]);
    await writeFile(join(tmp, "ignored.txt"), "ignored-after");

    await restoreCheckpoint(tmp, cp.id);

    expect(await readFile(join(tmp, "ignored.txt"), "utf-8")).toBe("ignored-before");
    await rm(tmp, { recursive: true });
  });

  it("rejects shadow metadata from another workspace", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-cp-"));
    const other = await mkdtemp(join(tmpdir(), "myagent-cp-other-"));
    await writeFile(join(tmp, "a.txt"), "content");

    const cp = await createCheckpoint(tmp, ["a.txt"]);
    const originalStore = getCheckpointStorePaths(tmp);
    const otherStore = getCheckpointStorePaths(other);
    await mkdir(otherStore.metadataDir, { recursive: true });
    const raw = await readFile(join(originalStore.metadataDir, `${cp.id}.json`), "utf-8");
    const copied = JSON.parse(raw);
    copied.workspaceHash = workspaceHash(tmp);
    copied.files = copied.files.map((file: { path: string }) => ({
      ...file,
      path: relative(other, join(tmp, file.path)),
    }));
    await writeFile(join(otherStore.metadataDir, `${cp.id}.json`), JSON.stringify(copied));

    await expect(restoreCheckpoint(other, cp.id)).rejects.toThrow("does not belong");

    await rm(tmp, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  });

  it("rejects checkpoint ids with path separators", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-cp-"));

    await expect(restoreCheckpoint(tmp, "../bad")).rejects.toThrow(
      "Invalid checkpoint id",
    );

    await rm(tmp, { recursive: true });
  });
});
