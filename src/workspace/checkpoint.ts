import { mkdir, readFile, writeFile, copyFile, unlink, stat } from "node:fs/promises";
import { join, dirname, relative, basename } from "node:path";
import { resolveWorkspacePath } from "./path.js";

export type CheckpointFile = {
  path: string;
  existed: boolean;
  snapshotPath?: string;
};

export type Checkpoint = {
  id: string;
  createdAt: string;
  cwd: string;
  files: CheckpointFile[];
};

function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}

export async function createCheckpoint(
  cwd: string,
  files: string[],
): Promise<Checkpoint> {
  const id = generateId();
  const checkpointDir = join(cwd, ".myagent", "checkpoints", id);

  const fileEntries: CheckpointFile[] = [];

  for (const filePath of files) {
    const absPath = resolveWorkspacePath(cwd, filePath);
    if (!absPath) {
      throw new Error(`Cannot checkpoint file outside workspace: ${filePath}`);
    }

    const relPath = relative(cwd, absPath);
    let existed = false;

    try {
      await stat(absPath);
      existed = true;
    } catch {
      existed = false;
    }

    if (existed) {
      const snapshotAbsPath = join(checkpointDir, relPath);
      await mkdir(dirname(snapshotAbsPath), { recursive: true });
      await copyFile(absPath, snapshotAbsPath);
      fileEntries.push({ path: relPath, existed: true, snapshotPath: relPath });
    } else {
      fileEntries.push({ path: relPath, existed: false });
    }
  }

  await mkdir(checkpointDir, { recursive: true });

  const checkpoint: Checkpoint = {
    id,
    createdAt: new Date().toISOString(),
    cwd,
    files: fileEntries,
  };

  await writeFile(
    join(checkpointDir, "metadata.json"),
    JSON.stringify(checkpoint, null, 2),
  );

  return checkpoint;
}

export async function restoreCheckpoint(
  cwd: string,
  checkpointId: string,
): Promise<Checkpoint> {
  if (checkpointId !== basename(checkpointId)) {
    throw new Error(`Invalid checkpoint id: ${checkpointId}`);
  }

  const checkpointDir = join(cwd, ".myagent", "checkpoints", checkpointId);
  const raw = await readFile(join(checkpointDir, "metadata.json"), "utf-8");
  const checkpoint: Checkpoint = JSON.parse(raw);

  for (const file of checkpoint.files) {
    const absPath = resolveWorkspacePath(cwd, file.path);
    if (!absPath) {
      throw new Error(`Cannot restore file outside workspace: ${file.path}`);
    }

    if (file.existed && file.snapshotPath) {
      const snapshotAbs = join(checkpointDir, file.snapshotPath);
      await mkdir(dirname(absPath), { recursive: true });
      await copyFile(snapshotAbs, absPath);
    } else {
      try {
        await unlink(absPath);
      } catch {
        // already gone
      }
    }
  }

  return checkpoint;
}
