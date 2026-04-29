import { isAbsolute, relative, resolve } from "node:path";

export function resolveWorkspacePath(cwd: string, inputPath: string): string | undefined {
  const workspaceRoot = resolve(cwd);
  const absPath = resolve(workspaceRoot, inputPath);
  const relPath = relative(workspaceRoot, absPath);

  if (relPath === "" || (!relPath.startsWith("..") && !isAbsolute(relPath))) {
    return absPath;
  }

  return undefined;
}
