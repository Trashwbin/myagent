import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

function isInside(base: string, target: string): boolean {
  const relPath = relative(base, target);
  return relPath === "" || (!relPath.startsWith("..") && !isAbsolute(relPath));
}

function nearestExistingAncestor(path: string): string | undefined {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return current;
}

export type WorkspacePathInfo = {
  inputPath: string;
  absolutePath: string;
  realPath: string;
  insideWorkspace: boolean;
  nearestExistingPath: string;
  missingRemainder?: string;
};

export function resolvePathInfo(
  cwd: string,
  inputPath: string,
): WorkspacePathInfo | undefined {
  const workspaceRoot = resolve(cwd);
  const absPath = isAbsolute(inputPath)
    ? resolve(inputPath)
    : resolve(workspaceRoot, inputPath);

  const nearest = nearestExistingAncestor(absPath);
  if (!nearest) return undefined;

  const nearestReal = realpathSync.native(nearest);

  let workspaceReal: string;
  try {
    workspaceReal = realpathSync.native(workspaceRoot);
  } catch {
    return undefined;
  }
  const nearestInside = isInside(workspaceReal, nearestReal);

  let realPath: string;
  let missingRemainder: string | undefined;

  if (existsSync(absPath)) {
    realPath = realpathSync.native(absPath);
  } else {
    const remainder = relative(nearest, absPath);
    realPath = remainder ? resolve(nearestReal, remainder) : nearestReal;
    missingRemainder = remainder || undefined;
  }

  return {
    inputPath,
    absolutePath: absPath,
    realPath,
    insideWorkspace: nearestInside,
    nearestExistingPath: nearestReal,
    missingRemainder,
  };
}
