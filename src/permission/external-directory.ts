import { findProjectRoot } from "../workspace/project-root.js";

const EXTERNAL_DIR_TOOLS = ["Read", "list_dir", "grep", "glob", "find_up"];

export function isExternalDirTool(toolName: string): boolean {
  return EXTERNAL_DIR_TOOLS.includes(toolName);
}

export function isExternalDirectoryCapable(
  toolName: string,
  metadata?: Record<string, unknown>,
): boolean {
  if (EXTERNAL_DIR_TOOLS.includes(toolName)) return true;
  if (toolName === "bash") {
    return metadata?.effect === "read" && !metadata?.sensitive;
  }
  return false;
}

export type ExternalDirectoryMeta = {
  externalDirectoryPattern: string;
  externalDirectoryRoot: string;
  externalDirectoryReason: "project_root" | "parent_directory";
};

export function buildExternalDirectoryMeta(
  toolName: string,
  realPath: string,
): ExternalDirectoryMeta {
  const isDir = toolName === "list_dir" || toolName === "grep" || toolName === "glob";
  const projectRoot = findProjectRoot(realPath, isDir);
  const root = projectRoot.root;
  return {
    externalDirectoryPattern: root + "/*",
    externalDirectoryRoot: root,
    externalDirectoryReason: projectRoot.reason,
  };
}

export function buildExternalDirectoryPattern(
  toolName: string,
  realPath: string,
): string {
  return buildExternalDirectoryMeta(toolName, realPath).externalDirectoryPattern;
}

export function matchesExternalDirectory(realPath: string, pattern: string): boolean {
  const dirPrefix = pattern.endsWith("/*") ? pattern.slice(0, -2) : pattern;
  return realPath === dirPrefix || realPath.startsWith(dirPrefix + "/");
}
