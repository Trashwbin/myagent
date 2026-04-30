import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

function isInside(base: string, target: string): boolean {
  const relPath = relative(base, target);
  return relPath === "" || (!relPath.startsWith("..") && !isAbsolute(relPath));
}

function nearestExistingPath(path: string): string | undefined {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return current;
}

export function resolveWorkspacePath(cwd: string, inputPath: string): string | undefined {
  const workspaceRoot = resolve(cwd);
  const workspaceRealPath = realpathSync.native(workspaceRoot);
  const absPath = resolve(workspaceRoot, inputPath);

  const existingPath = nearestExistingPath(absPath);
  if (!existingPath) {
    return undefined;
  }

  const existingRealPath = realpathSync.native(existingPath);
  if (!isInside(workspaceRealPath, existingRealPath)) {
    return undefined;
  }

  return absPath;
}
