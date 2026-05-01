import { dirname, resolve, relative } from "node:path";
import { realpathSync, existsSync, statSync } from "node:fs";

const PROJECT_MARKERS = [
  ".git",
  "package.json",
  "pnpm-workspace.yaml",
  "yarn.lock",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "go.mod",
  "Cargo.toml",
  "pyproject.toml",
];

export type ProjectRootResult = {
  root: string;
  reason: "project_root" | "parent_directory";
};

export function findProjectRoot(
  startPath: string,
  isDirectory?: boolean,
): ProjectRootResult {
  const resolved = resolve(startPath);

  // Resolve to canonical path via nearest existing ancestor
  let nearest = resolved;
  while (!existsSync(nearest)) {
    const parent = dirname(nearest);
    if (parent === nearest) break;
    nearest = parent;
  }
  const canonicalBase = existsSync(nearest) ? realpathSync.native(nearest) : nearest;
  const remainder = relative(nearest, resolved);
  const realPath = remainder ? resolve(canonicalBase, remainder) : canonicalBase;

  const startDir =
    statSync(realPath, { throwIfNoEntry: false })?.isDirectory() ||
    (!existsSync(realPath) && isDirectory)
      ? realPath
      : dirname(realPath);

  let current = startDir;
  let lastMarkerDir: string | undefined;

  while (true) {
    for (const marker of PROJECT_MARKERS) {
      if (existsSync(resolve(current, marker))) {
        lastMarkerDir = current;
        break;
      }
    }
    if (lastMarkerDir) break;

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  if (lastMarkerDir) {
    return { root: lastMarkerDir, reason: "project_root" };
  }

  // No marker found — use conservative parent directory, but never root/home
  const home = process.env.HOME ?? "";
  const homeReal = home && existsSync(home) ? realpathSync.native(home) : home;

  if (startDir === "/" || startDir === homeReal) {
    return { root: startDir, reason: "parent_directory" };
  }

  return { root: startDir, reason: "parent_directory" };
}
