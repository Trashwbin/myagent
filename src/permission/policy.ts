import { resolvePathInfo } from "../workspace/path-info.js";
import type { WorkspacePathInfo } from "../workspace/path-info.js";
import { checkReadPolicy, isSensitiveReadPath } from "./read-policy.js";
import { analyzeCommand } from "./command-policy.js";
import { buildExternalDirectoryMeta } from "./external-directory.js";
import { readFileSync } from "node:fs";
import {
  computeDiff,
  normalizeToLf,
  detectLineEnding,
  applyLineEnding,
} from "../tools/file-mutation.js";

export type ApprovalMode = "auto" | "on-request" | "never";

export type ToolPermissionDecision = {
  behavior: "allow" | "ask" | "deny";
  reason: string;
  resolvedInput?: unknown;
  metadata?: Record<string, unknown>;
};

function pathMeta(info: WorkspacePathInfo): Record<string, unknown> {
  return {
    inputPath: info.inputPath,
    absolutePath: info.absolutePath,
    realPath: info.realPath,
    insideWorkspace: info.insideWorkspace,
  };
}

export function checkToolPermission(
  toolName: string,
  input: unknown,
  mode: ApprovalMode,
  cwd: string,
): ToolPermissionDecision {
  const finalize = (decision: ToolPermissionDecision): ToolPermissionDecision => {
    if (mode === "never" && decision.behavior === "ask") {
      return {
        ...decision,
        behavior: "deny",
        reason: `${decision.reason}; approval mode is never`,
      };
    }
    return decision;
  };

  switch (toolName) {
    case "read_file":
      return finalize(checkReadFile(input, cwd));
    case "list_dir":
      return finalize(checkListDir(input, cwd));
    case "search":
      return finalize(checkSearch(input, cwd));
    case "edit_file":
      return finalize(checkEditFile(input, mode, cwd));
    case "write_file":
      return finalize(checkWriteFile(input, mode, cwd));
    case "bash":
      return finalize(checkBash(input, cwd));
    default:
      return { behavior: "deny", reason: `unknown tool: ${toolName}` };
  }
}

function checkReadFile(input: unknown, cwd: string): ToolPermissionDecision {
  const { path } = input as { path: string };
  const policy = checkReadPolicy(cwd, path);
  const sensitive = isSensitiveReadPath(policy.pathInfo.realPath);
  const metadata: Record<string, unknown> = {
    ...pathMeta(policy.pathInfo),
    sensitive,
  };
  if (!policy.pathInfo.insideWorkspace && !sensitive) {
    Object.assign(
      metadata,
      buildExternalDirectoryMeta("read_file", policy.pathInfo.realPath),
    );
  }
  return {
    behavior: policy.behavior,
    reason: policy.reason,
    resolvedInput: {
      path,
      resolvedPath: policy.pathInfo.absolutePath,
      realPath: policy.pathInfo.realPath,
    },
    metadata,
  };
}

function checkListDir(input: unknown, cwd: string): ToolPermissionDecision {
  const { path } = input as { path: string };
  const policy = checkReadPolicy(cwd, path);
  const sensitive = isSensitiveReadPath(policy.pathInfo.realPath);
  const metadata: Record<string, unknown> = {
    ...pathMeta(policy.pathInfo),
    sensitive,
  };
  if (!policy.pathInfo.insideWorkspace && !sensitive) {
    Object.assign(
      metadata,
      buildExternalDirectoryMeta("list_dir", policy.pathInfo.realPath),
    );
  }
  return {
    behavior: policy.behavior,
    reason: policy.reason,
    resolvedInput: {
      path,
      resolvedPath: policy.pathInfo.absolutePath,
      realPath: policy.pathInfo.realPath,
    },
    metadata,
  };
}

function checkSearch(input: unknown, cwd: string): ToolPermissionDecision {
  const { pattern, path: searchPath = "." } = input as {
    pattern: string;
    path?: string;
  };
  const policy = checkReadPolicy(cwd, searchPath);
  const sensitive = isSensitiveReadPath(policy.pathInfo.realPath);

  const reasonMap: Record<string, string> = {
    "sensitive file read requires approval": "sensitive path search requires approval",
    "file is outside workspace": "search path is outside workspace",
    "workspace read is safe": "workspace search is safe",
  };

  const metadata: Record<string, unknown> = {
    ...pathMeta(policy.pathInfo),
    sensitive,
  };
  if (!policy.pathInfo.insideWorkspace && !sensitive) {
    Object.assign(
      metadata,
      buildExternalDirectoryMeta("search", policy.pathInfo.realPath),
    );
  }

  return {
    behavior: policy.behavior,
    reason: reasonMap[policy.reason] ?? policy.reason,
    resolvedInput: {
      pattern,
      path: searchPath,
      resolvedPath: policy.pathInfo.absolutePath,
      realPath: policy.pathInfo.realPath,
      excludeSensitive: !sensitive,
    },
    metadata,
  };
}

function checkEditFile(
  input: unknown,
  mode: ApprovalMode,
  cwd: string,
): ToolPermissionDecision {
  const {
    path,
    old_string,
    new_string,
    replace_all = false,
  } = input as {
    path: string;
    old_string: string;
    new_string: string;
    replace_all?: boolean;
  };

  if (mode === "never") {
    return { behavior: "deny", reason: "edits denied in never-approval mode" };
  }

  const pathInfo = resolvePathInfo(cwd, path);
  if (!pathInfo) {
    return { behavior: "deny", reason: "path cannot be resolved" };
  }

  if (!pathInfo.insideWorkspace) {
    return {
      behavior: "deny",
      reason: "cannot edit files outside workspace",
      metadata: pathMeta(pathInfo),
    };
  }

  const metadata = pathMeta(pathInfo);
  if (!isSensitiveReadPath(pathInfo.realPath)) {
    Object.assign(
      metadata,
      buildEditDiffMeta(pathInfo.absolutePath, path, old_string, new_string, replace_all),
    );
  } else {
    metadata.operation = "edit";
    metadata.sensitive = true;
  }

  return {
    behavior: "ask",
    reason: "file edits require approval",
    resolvedInput: {
      path,
      resolvedPath: pathInfo.absolutePath,
      old_string,
      new_string,
      replace_all,
    },
    metadata,
  };
}

function checkWriteFile(
  input: unknown,
  mode: ApprovalMode,
  cwd: string,
): ToolPermissionDecision {
  const { path, content } = input as { path: string; content: string };

  if (mode === "never") {
    return { behavior: "deny", reason: "writes denied in never-approval mode" };
  }

  const pathInfo = resolvePathInfo(cwd, path);
  if (!pathInfo) {
    return { behavior: "deny", reason: "path cannot be resolved" };
  }

  if (!pathInfo.insideWorkspace) {
    return {
      behavior: "deny",
      reason: "cannot write files outside workspace",
      metadata: pathMeta(pathInfo),
    };
  }

  const metadata = pathMeta(pathInfo);
  if (!isSensitiveReadPath(pathInfo.realPath)) {
    Object.assign(metadata, buildWriteDiffMeta(pathInfo.absolutePath, path, content));
  } else {
    metadata.operation = "write";
    metadata.sensitive = true;
  }

  return {
    behavior: "ask",
    reason: "file writes require approval",
    resolvedInput: {
      path,
      content,
      resolvedPath: pathInfo.absolutePath,
      realPath: pathInfo.realPath,
    },
    metadata,
  };
}

function buildWriteDiffMeta(absPath: string, displayPath: string, content: string) {
  let oldContent = "";
  let exists = false;
  try {
    oldContent = readFileSync(absPath, "utf-8");
    exists = true;
  } catch {
    // New file or unreadable file; permission still asks and tool reports execution errors.
  }
  const diff = computeDiff(oldContent, content, displayPath);
  return {
    operation: exists ? "write" : "create",
    diff: diff.diff,
    additions: diff.additions,
    deletions: diff.deletions,
  };
}

function buildEditDiffMeta(
  absPath: string,
  displayPath: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
) {
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

function checkBash(input: unknown, cwd: string): ToolPermissionDecision {
  const command = (input as { command: string }).command ?? "";
  const policy = analyzeCommand(command, { cwd });
  const metadata: Record<string, unknown> = {};
  if (policy.commands) metadata.commands = policy.commands;
  if (policy.paths) metadata.paths = policy.paths;
  if (policy.sensitive !== undefined) metadata.sensitive = policy.sensitive;
  if (policy.effect) metadata.effect = policy.effect;
  if (policy.effectiveCwd) metadata.effectiveCwd = policy.effectiveCwd;
  if (policy.externalDirectoryPattern)
    metadata.externalDirectoryPattern = policy.externalDirectoryPattern;
  if (policy.externalDirectoryRoot)
    metadata.externalDirectoryRoot = policy.externalDirectoryRoot;
  if (policy.externalDirectoryReason)
    metadata.externalDirectoryReason = policy.externalDirectoryReason;
  if (policy.approvalPattern) metadata.approvalPattern = policy.approvalPattern;
  return {
    behavior: policy.decision,
    reason: policy.reason,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}
