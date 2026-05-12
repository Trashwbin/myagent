import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

export type CheckpointBackend = "shadow-git" | "copy-v1";

export type CheckpointFile = {
  path: string;
  existed: boolean;
  snapshotPath?: string;
  mode?: string;
  blobHash?: string;
};

export type Checkpoint = {
  id: string;
  createdAt: string;
  cwd: string;
  files: CheckpointFile[];
  version?: number;
  backend?: CheckpointBackend;
  workspaceHash?: string;
  treeHash?: string;
  commitHash?: string;
  parentCommitHash?: string;
  reason?: string;
};

export type CheckpointStorePaths = {
  root: string;
  repo: string;
  metadataDir: string;
  workspaceHash: string;
};

export function generateCheckpointId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}

export function assertCheckpointId(checkpointId: string): void {
  if (checkpointId !== basename(checkpointId)) {
    throw new Error(`Invalid checkpoint id: ${checkpointId}`);
  }
}

export function getMyAgentHome(): string {
  return process.env.MYAGENT_HOME ?? join(homedir(), ".myagent");
}

export function workspaceHash(cwd: string): string {
  return createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 24);
}

export function getCheckpointStorePaths(cwd: string): CheckpointStorePaths {
  const hash = workspaceHash(cwd);
  const root = join(getMyAgentHome(), "checkpoints", hash);
  return {
    root,
    repo: join(root, "repo.git"),
    metadataDir: join(root, "checkpoints"),
    workspaceHash: hash,
  };
}

export async function writeShadowCheckpointMetadata(
  cwd: string,
  checkpoint: Checkpoint,
): Promise<void> {
  const paths = getCheckpointStorePaths(cwd);
  await mkdir(paths.metadataDir, { recursive: true });
  await writeFile(
    join(paths.metadataDir, `${checkpoint.id}.json`),
    JSON.stringify(checkpoint, null, 2),
  );
}

export async function readShadowCheckpointMetadata(
  cwd: string,
  checkpointId: string,
): Promise<Checkpoint | undefined> {
  assertCheckpointId(checkpointId);
  const paths = getCheckpointStorePaths(cwd);
  try {
    const raw = await readFile(join(paths.metadataDir, `${checkpointId}.json`), "utf-8");
    return JSON.parse(raw) as Checkpoint;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function listShadowCheckpointMetadata(cwd: string): Promise<Checkpoint[]> {
  const paths = getCheckpointStorePaths(cwd);
  let entries: string[];
  try {
    entries = await readdir(paths.metadataDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const checkpoints = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => {
        const raw = await readFile(join(paths.metadataDir, entry), "utf-8");
        return JSON.parse(raw) as Checkpoint;
      }),
  );

  return checkpoints.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
