import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function getGitDiffStat(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--stat"], {
      cwd,
      timeout: 5_000,
    });
    return stdout || null;
  } catch {
    return null;
  }
}

export async function getGitDiff(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["diff"], {
      cwd,
      timeout: 5_000,
    });
    return stdout || null;
  } catch {
    return null;
  }
}
