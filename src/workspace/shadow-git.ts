import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { Checkpoint, CheckpointFile } from "./checkpoint-store.js";
import { getCheckpointStorePaths, writeShadowCheckpointMetadata } from "./checkpoint-store.js";

const execFileAsync = promisify(execFile);
const HEAD_REF = "refs/heads/checkpoints";

async function git(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  try {
    const result = await execFileAsync("git", args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      timeout: 10_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    return result.stdout.trim();
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === "ENOENT") {
      throw new Error("git is required for shadow checkpoint backend");
    }
    const detail = err.stderr?.toString().trim();
    throw new Error(detail ? `git failed: ${detail}` : "git failed");
  }
}

export async function ensureShadowGitRepo(cwd: string): Promise<void> {
  const paths = getCheckpointStorePaths(cwd);
  await mkdir(paths.root, { recursive: true });

  try {
    await stat(join(paths.repo, "HEAD"));
    return;
  } catch {
    await git(["init", "--bare", paths.repo]);
  }
}

export async function writeBlob(cwd: string, absPath: string): Promise<string> {
  await ensureShadowGitRepo(cwd);
  const paths = getCheckpointStorePaths(cwd);
  return git([
    `--git-dir=${paths.repo}`,
    `--work-tree=${cwd}`,
    "hash-object",
    "-w",
    "--no-filters",
    "--",
    absPath,
  ]);
}

export async function readBlob(cwd: string, blobHash: string): Promise<Buffer> {
  await ensureShadowGitRepo(cwd);
  const paths = getCheckpointStorePaths(cwd);
  const stdout = await execFileAsync(
    "git",
    [`--git-dir=${paths.repo}`, `--work-tree=${cwd}`, "cat-file", "-p", blobHash],
    {
      env: process.env,
      encoding: "buffer",
      timeout: 10_000,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  return stdout.stdout as Buffer;
}

export async function createTree(cwd: string, files: CheckpointFile[]): Promise<string> {
  await ensureShadowGitRepo(cwd);
  const paths = getCheckpointStorePaths(cwd);
  const lines = files
    .filter((file) => file.existed && file.blobHash)
    .map((file) => `${file.mode ?? "100644"} ${file.blobHash}\t${file.path}`)
    .join("\n");

  const indexDir = await mkdtemp(join(tmpdir(), "myagent-checkpoint-index-"));
  const indexPath = join(indexDir, "index");
  const env = { GIT_INDEX_FILE: indexPath };

  try {
    await git([`--git-dir=${paths.repo}`, `--work-tree=${cwd}`, "read-tree", "--empty"], {
      env,
    });

    if (lines) {
      await new Promise<void>((resolve, reject) => {
        const child = execFile(
          "git",
          [
            `--git-dir=${paths.repo}`,
            `--work-tree=${cwd}`,
            "update-index",
            "--index-info",
          ],
          {
            env: { ...process.env, ...env },
            timeout: 10_000,
            maxBuffer: 20 * 1024 * 1024,
          },
          (error, _stdout, stderr) => {
            if (error) {
              reject(new Error(stderr?.toString().trim() || "git update-index failed"));
              return;
            }
            resolve();
          },
        );
        child.stdin?.end(`${lines}\n`);
      });
    }

    return await git([`--git-dir=${paths.repo}`, `--work-tree=${cwd}`, "write-tree"], {
      env,
    });
  } finally {
    await rm(indexDir, { recursive: true, force: true });
  }
}

export async function createCommit(
  cwd: string,
  treeHash: string,
  checkpointId: string,
  parentCommitHash?: string,
): Promise<string> {
  await ensureShadowGitRepo(cwd);
  const paths = getCheckpointStorePaths(cwd);
  const args = [`--git-dir=${paths.repo}`, `--work-tree=${cwd}`, "commit-tree", treeHash];
  if (parentCommitHash) args.push("-p", parentCommitHash);
  args.push("-m", `checkpoint ${checkpointId}`);

  return git(args, {
    env: {
      GIT_AUTHOR_NAME: "myagent",
      GIT_AUTHOR_EMAIL: "myagent@example.local",
      GIT_COMMITTER_NAME: "myagent",
      GIT_COMMITTER_EMAIL: "myagent@example.local",
    },
  });
}

async function readParentCommit(cwd: string): Promise<string | undefined> {
  await ensureShadowGitRepo(cwd);
  const paths = getCheckpointStorePaths(cwd);
  try {
    const raw = await readFile(join(paths.repo, HEAD_REF), "utf-8");
    return raw.trim() || undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function updateCheckpointHead(cwd: string, commitHash: string): Promise<void> {
  await ensureShadowGitRepo(cwd);
  const paths = getCheckpointStorePaths(cwd);
  await git([`--git-dir=${paths.repo}`, `--work-tree=${cwd}`, "update-ref", HEAD_REF, commitHash]);
}

export async function createShadowCheckpoint(
  cwd: string,
  checkpoint: Checkpoint,
): Promise<Checkpoint> {
  const paths = getCheckpointStorePaths(cwd);
  const parentCommitHash = await readParentCommit(cwd);
  const treeHash = await createTree(cwd, checkpoint.files);
  const commitHash = await createCommit(cwd, treeHash, checkpoint.id, parentCommitHash);
  const stored: Checkpoint = {
    ...checkpoint,
    version: 2,
    backend: "shadow-git",
    workspaceHash: paths.workspaceHash,
    treeHash,
    commitHash,
    parentCommitHash,
  };
  await writeShadowCheckpointMetadata(cwd, stored);
  await updateCheckpointHead(cwd, commitHash);
  return stored;
}

export type PreparedShadowRestore = {
  file: CheckpointFile;
  absPath: string;
  content?: Buffer;
};

export async function prepareShadowRestoreFile(
  cwd: string,
  file: CheckpointFile,
  absPath: string,
): Promise<PreparedShadowRestore> {
  if (file.existed && file.blobHash) {
    return {
      file,
      absPath,
      content: await readBlob(cwd, file.blobHash),
    };
  }

  return { file, absPath };
}

export async function applyPreparedShadowRestore(
  prepared: PreparedShadowRestore,
): Promise<void> {
  if (prepared.file.existed && prepared.content) {
    await mkdir(dirname(prepared.absPath), { recursive: true });
    await writeFile(prepared.absPath, prepared.content);
    await chmod(prepared.absPath, prepared.file.mode === "100755" ? 0o755 : 0o644);
    return;
  }

  await rm(prepared.absPath, { force: true });
}
