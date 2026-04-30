import { resolve } from "node:path";
import { resolvePathInfo } from "../workspace/path-info.js";
import type { WorkspacePathInfo } from "../workspace/path-info.js";
export { isSensitiveReadPath } from "./sensitive-paths.js";
import { isSensitiveReadPath } from "./sensitive-paths.js";

export type ReadPolicyResult = {
  behavior: "allow" | "ask" | "deny";
  reason: string;
  pathInfo: WorkspacePathInfo;
};

export function checkReadPolicy(cwd: string, inputPath: string): ReadPolicyResult {
  const pathInfo = resolvePathInfo(cwd, inputPath);
  if (!pathInfo) {
    return {
      behavior: "deny",
      reason: "path cannot be resolved",
      pathInfo: {
        inputPath,
        absolutePath: resolve(cwd, inputPath),
        realPath: "",
        insideWorkspace: false,
        nearestExistingPath: "",
      },
    };
  }

  if (isSensitiveReadPath(pathInfo.realPath)) {
    return { behavior: "ask", reason: "sensitive file read requires approval", pathInfo };
  }

  if (pathInfo.insideWorkspace) {
    return { behavior: "allow", reason: "workspace read is safe", pathInfo };
  }

  return { behavior: "ask", reason: "file is outside workspace", pathInfo };
}
