import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import {
  assertCheckpointId,
  generateCheckpointId,
  getCheckpointStorePaths,
  listShadowCheckpointMetadata,
  readShadowCheckpointMetadata,
  type Checkpoint,
  type CheckpointFile,
} from "./checkpoint-store.js";
import {
  applyPreparedShadowRestore,
  createShadowCheckpoint,
  prepareShadowRestoreFile,
  writeBlob,
} from "./shadow-git.js";
import { resolveWorkspacePath } from "./path.js";

export type { Checkpoint, CheckpointFile } from "./checkpoint-store.js";

async function fileMode(absPath: string): Promise<string> {
  const info = await stat(absPath);
  return info.mode & 0o111 ? "100755" : "100644";
}

async function buildShadowCheckpointFiles(cwd: string, files: string[]): Promise<CheckpointFile[]> {
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
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    if (!existed) {
      fileEntries.push({ path: relPath, existed: false });
      continue;
    }

    fileEntries.push({
      path: relPath,
      existed: true,
      mode: await fileMode(absPath),
      blobHash: await writeBlob(cwd, absPath),
    });
  }

  return fileEntries;
}

async function buildLegacyCheckpointFiles(cwd: string, files: string[]): Promise<CheckpointFile[]> {
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
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    if (existed) {
      fileEntries.push({ path: relPath, existed: true });
    } else {
      fileEntries.push({ path: relPath, existed: false });
    }
  }

  return fileEntries;
}

async function collectWorkspaceFiles(cwd: string, dir = cwd): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === ".myagent") continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectWorkspaceFiles(cwd, abs)));
    } else if (entry.isFile()) {
      files.push(relative(cwd, abs));
    }
  }

  return files;
}

async function readLegacyCheckpoint(
  cwd: string,
  checkpointId: string,
): Promise<Checkpoint | undefined> {
  const checkpointDir = join(cwd, ".myagent", "checkpoints", checkpointId);
  try {
    const raw = await readFile(join(checkpointDir, "metadata.json"), "utf-8");
    const checkpoint = JSON.parse(raw) as Checkpoint;
    return { ...checkpoint, backend: "copy-v1" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function restoreLegacyCheckpoint(cwd: string, checkpoint: Checkpoint): Promise<void> {
  const checkpointDir = join(cwd, ".myagent", "checkpoints", checkpoint.id);

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
      await rm(absPath, { force: true });
    }
  }
}

async function writeLegacyCheckpointForTests(
  cwd: string,
  checkpoint: Checkpoint,
): Promise<Checkpoint> {
  const checkpointDir = join(cwd, ".myagent", "checkpoints", checkpoint.id);
  const legacyFiles: CheckpointFile[] = [];

  for (const file of checkpoint.files) {
    const absPath = resolveWorkspacePath(cwd, file.path);
    if (!absPath) {
      throw new Error(`Cannot checkpoint file outside workspace: ${file.path}`);
    }

    if (file.existed) {
      const snapshotAbsPath = join(checkpointDir, file.path);
      await mkdir(dirname(snapshotAbsPath), { recursive: true });
      await copyFile(absPath, snapshotAbsPath);
      legacyFiles.push({ path: file.path, existed: true, snapshotPath: file.path });
    } else {
      legacyFiles.push({ path: file.path, existed: false });
    }
  }

  await mkdir(checkpointDir, { recursive: true });
  const legacy: Checkpoint = {
    id: checkpoint.id,
    createdAt: checkpoint.createdAt,
    cwd,
    files: legacyFiles,
  };
  await writeFile(join(checkpointDir, "metadata.json"), JSON.stringify(legacy, null, 2));
  return legacy;
}

export async function createCheckpoint(
  cwd: string,
  files: string[],
): Promise<Checkpoint> {
  if (process.env.MYAGENT_CHECKPOINT_BACKEND === "copy-v1") {
    const checkpoint: Checkpoint = {
      id: generateCheckpointId(),
      createdAt: new Date().toISOString(),
      cwd,
      files: await buildLegacyCheckpointFiles(cwd, files),
    };
    return writeLegacyCheckpointForTests(cwd, checkpoint);
  }

  const checkpoint: Checkpoint = {
    id: generateCheckpointId(),
    createdAt: new Date().toISOString(),
    cwd,
    files: await buildShadowCheckpointFiles(cwd, files),
  };

  return createShadowCheckpoint(cwd, checkpoint);
}

export async function restoreCheckpoint(
  cwd: string,
  checkpointId: string,
): Promise<Checkpoint> {
  assertCheckpointId(checkpointId);

  const shadow = await readShadowCheckpointMetadata(cwd, checkpointId);
  if (shadow) {
    const paths = getCheckpointStorePaths(cwd);
    if (shadow.workspaceHash && shadow.workspaceHash !== paths.workspaceHash) {
      throw new Error(`Checkpoint ${checkpointId} does not belong to this workspace`);
    }

    const prepared = [];
    for (const file of shadow.files) {
      const absPath = resolveWorkspacePath(cwd, file.path);
      if (!absPath) {
        throw new Error(`Cannot restore file outside workspace: ${file.path}`);
      }
      prepared.push(await prepareShadowRestoreFile(cwd, file, absPath));
    }

    for (const item of prepared) {
      await applyPreparedShadowRestore(item);
    }

    return shadow;
  }

  const legacy = await readLegacyCheckpoint(cwd, checkpointId);
  if (!legacy) {
    throw new Error(`Checkpoint not found: ${checkpointId}`);
  }

  if (legacy.id !== basename(legacy.id)) {
    throw new Error(`Invalid checkpoint id: ${legacy.id}`);
  }

  await restoreLegacyCheckpoint(cwd, legacy);
  return legacy;
}

export async function getCheckpoint(
  cwd: string,
  checkpointId: string,
): Promise<Checkpoint | undefined> {
  assertCheckpointId(checkpointId);
  const shadow = await readShadowCheckpointMetadata(cwd, checkpointId);
  if (shadow) return shadow;
  return readLegacyCheckpoint(cwd, checkpointId);
}

export async function listCheckpoints(cwd: string): Promise<Checkpoint[]> {
  const shadow = await listShadowCheckpointMetadata(cwd);
  return shadow;
}

export async function createRestorePoint(cwd: string, reason: string): Promise<Checkpoint> {
  const checkpoint: Checkpoint = {
    id: generateCheckpointId(),
    createdAt: new Date().toISOString(),
    cwd,
    reason,
    files: await buildShadowCheckpointFiles(cwd, await collectWorkspaceFiles(cwd)),
  };
  return createShadowCheckpoint(cwd, checkpoint);
}
