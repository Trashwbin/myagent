import { describe, it, expect } from "vitest";
import { createCheckpoint, restoreCheckpoint } from "../src/workspace/checkpoint.js";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
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

  it("metadata contains id and createdAt", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-cp-"));
    await writeFile(join(tmp, "a.txt"), "content");

    const cp = await createCheckpoint(tmp, ["a.txt"]);
    expect(cp.id).toBeTruthy();
    expect(cp.createdAt).toBeTruthy();
    expect(cp.cwd).toBe(tmp);

    // Verify metadata.json was written
    const metadata = await readFile(
      join(tmp, ".myagent", "checkpoints", cp.id, "metadata.json"),
      "utf-8",
    );
    const parsed = JSON.parse(metadata);
    expect(parsed.id).toBe(cp.id);

    await rm(tmp, { recursive: true });
  });

  it("rejects checkpoint ids with path separators", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-cp-"));

    await expect(restoreCheckpoint(tmp, "../bad")).rejects.toThrow(
      "Invalid checkpoint id",
    );

    await rm(tmp, { recursive: true });
  });
});
