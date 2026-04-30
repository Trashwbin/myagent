import { resolvePathInfo } from "./path-info.js";

export function resolveWorkspacePath(cwd: string, inputPath: string): string | undefined {
  const pathInfo = resolvePathInfo(cwd, inputPath);
  if (!pathInfo || !pathInfo.insideWorkspace) return undefined;
  return pathInfo.absolutePath;
}
