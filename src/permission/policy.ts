import { resolvePathInfo } from "../workspace/path-info.js";
import type { WorkspacePathInfo } from "../workspace/path-info.js";
import { checkReadPolicy, isSensitiveReadPath } from "./read-policy.js";
import { analyzeCommand } from "./command-policy.js";

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
  return {
    behavior: policy.behavior,
    reason: policy.reason,
    resolvedInput: {
      path,
      resolvedPath: policy.pathInfo.absolutePath,
      realPath: policy.pathInfo.realPath,
    },
    metadata: { ...pathMeta(policy.pathInfo), sensitive },
  };
}

function checkSearch(input: unknown, cwd: string): ToolPermissionDecision {
  const { pattern, path: searchPath = "." } = input as { pattern: string; path?: string };
  const policy = checkReadPolicy(cwd, searchPath);
  const sensitive = isSensitiveReadPath(policy.pathInfo.realPath);

  const reasonMap: Record<string, string> = {
    "sensitive file read requires approval": "sensitive path search requires approval",
    "file is outside workspace": "search path is outside workspace",
    "workspace read is safe": "workspace search is safe",
  };

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
    metadata: { ...pathMeta(policy.pathInfo), sensitive },
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
  return {
    behavior: policy.decision,
    reason: policy.reason,
    metadata:
      policy.commands || policy.paths
        ? { commands: policy.commands, paths: policy.paths }
        : undefined,
  };
}
