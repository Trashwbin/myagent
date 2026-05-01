import { resolvePathInfo } from "../workspace/path-info.js";
import type { WorkspacePathInfo } from "../workspace/path-info.js";
import { checkReadPolicy, isSensitiveReadPath } from "./read-policy.js";
import { analyzeCommand } from "./command-policy.js";
import { buildExternalDirectoryMeta } from "./external-directory.js";

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
  const { path, old_string, new_string } = input as {
    path: string;
    old_string: string;
    new_string: string;
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

  return {
    behavior: "ask",
    reason: "file edits require approval",
    resolvedInput: {
      path,
      resolvedPath: pathInfo.absolutePath,
      old_string,
      new_string,
    },
    metadata: pathMeta(pathInfo),
  };
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
