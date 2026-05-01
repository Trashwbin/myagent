import { resolvePathInfo } from "../workspace/path-info.js";
import type { WorkspacePathInfo } from "../workspace/path-info.js";
import { isSensitiveReadPath } from "../permission/sensitive-paths.js";
import { readFileSync, statSync } from "node:fs";
import {
  computeDiff,
  normalizeToLf,
  detectLineEnding,
  applyLineEnding,
} from "./file-mutation.js";

// --- Path metadata ---

export function pathMeta(info: WorkspacePathInfo): Record<string, unknown> {
  return {
    inputPath: info.inputPath,
    absolutePath: info.absolutePath,
    realPath: info.realPath,
    insideWorkspace: info.insideWorkspace,
  };
}

// --- Shared path validation for single-file mutation tools ---

export type PathValidationResult =
  | { ok: true; pathInfo: WorkspacePathInfo }
  | { ok: false; reason: string; metadata?: Record<string, unknown> };

export function validateMutationPath(
  path: string,
  cwd: string,
): PathValidationResult {
  const pathInfo = resolvePathInfo(cwd, path);
  if (!pathInfo) {
    return { ok: false, reason: "path cannot be resolved" };
  }
  if (!pathInfo.insideWorkspace) {
    return {
      ok: false,
      reason: "cannot modify files outside workspace",
      metadata: pathMeta(pathInfo),
    };
  }
  return { ok: true, pathInfo };
}

// --- Diff metadata builders (used by permission system) ---

export type WriteTargetKind = "absent" | "file" | "directory";

export function classifyWriteTarget(absPath: string): WriteTargetKind {
  try {
    const s = statSync(absPath);
    return s.isDirectory() ? "directory" : "file";
  } catch {
    return "absent";
  }
}

export function buildWriteDiffMeta(
  absPath: string,
  displayPath: string,
  content: string,
): Record<string, unknown> {
  const kind = classifyWriteTarget(absPath);
  if (kind === "directory") {
    return { operation: "directory", target: "directory" };
  }
  if (kind === "absent") {
    const diff = computeDiff("", content, displayPath);
    return {
      operation: "create",
      diff: diff.diff,
      additions: diff.additions,
      deletions: diff.deletions,
    };
  }
  let oldContent = "";
  try {
    oldContent = readFileSync(absPath, "utf-8");
  } catch {
    // Unreadable file; permission still asks and tool reports execution errors.
  }
  const diff = computeDiff(oldContent, content, displayPath);
  return {
    operation: "write",
    diff: diff.diff,
    additions: diff.additions,
    deletions: diff.deletions,
  };
}

export function buildEditDiffMeta(
  absPath: string,
  displayPath: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): Record<string, unknown> {
  try {
    const content = readFileSync(absPath, "utf-8");
    const lineEnding = detectLineEnding(content);
    const normalizedContent = normalizeToLf(content);
    const normalizedOld = normalizeToLf(oldString);
    const normalizedNew = normalizeToLf(newString);

    if (!normalizedOld || oldString === newString) {
      return { operation: "edit" };
    }
    const count = normalizedContent.split(normalizedOld).length - 1;
    if (count === 0 || (!replaceAll && count > 1)) {
      return { operation: "edit", matchCount: count };
    }
    const updatedLf = replaceAll
      ? normalizedContent.split(normalizedOld).join(normalizedNew)
      : normalizedContent.replace(normalizedOld, normalizedNew);
    const updated = applyLineEnding(updatedLf, lineEnding);
    const diff = computeDiff(content, updated, displayPath);
    return {
      operation: "edit",
      matchCount: count,
      diff: diff.diff,
      additions: diff.additions,
      deletions: diff.deletions,
    };
  } catch {
    return { operation: "edit" };
  }
}

// --- Sensitive metadata guard ---

export function isSensitivePath(realPath: string): boolean {
  return isSensitiveReadPath(realPath);
}

// --- Checkpoint helpers ---

export function isMutationTool(toolName: string): boolean {
  return (
    toolName === "edit_file" ||
    toolName === "write_file" ||
    toolName === "apply_patch"
  );
}

export function getCheckpointPaths(
  toolName: string,
  resolvedInput: unknown,
): string[] {
  if (toolName === "edit_file" || toolName === "write_file") {
    const input = resolvedInput as { resolvedPath?: string; path: string };
    return [input.resolvedPath ?? input.path];
  }
  if (toolName === "apply_patch") {
    const input = resolvedInput as { resolvedPaths?: Record<string, string> };
    return input.resolvedPaths ? Object.keys(input.resolvedPaths) : [];
  }
  return [];
}
