import { resolvePathInfo } from "../workspace/path-info.js";
import { checkReadPolicy, isSensitiveReadPath } from "./read-policy.js";
import { analyzeCommand } from "./command-policy.js";
import { buildExternalDirectoryMeta } from "./external-directory.js";
import {
  parsePatch,
  resolvePatchPaths,
  buildPatchDiffMeta,
} from "../tools/apply-patch.js";
import {
  pathMeta,
  validateMutationPath,
  buildEditDiffMeta,
  buildWriteDiffMeta,
  classifyWriteTarget,
  isSensitivePath,
} from "../tools/mutation-policy.js";

export type ApprovalMode = "auto" | "on-request" | "never";

export type ToolPermissionDecision = {
  behavior: "allow" | "ask" | "deny";
  reason: string;
  resolvedInput?: unknown;
  metadata?: Record<string, unknown>;
};

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
    case "apply_patch":
      return finalize(checkApplyPatch(input, mode, cwd));
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
  const {
    pattern,
    path: searchPath = ".",
    exclude = [],
    max_results = 200,
  } = input as {
    pattern: string;
    path?: string;
    exclude?: string[];
    max_results?: number;
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
      exclude,
      max_results,
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

  const pathResult = validateMutationPath(path, cwd);
  if (!pathResult.ok) {
    return { behavior: "deny", reason: pathResult.reason, metadata: pathResult.metadata };
  }

  const { pathInfo } = pathResult;
  const sensitive = isSensitivePath(pathInfo.realPath);
  const metadata: Record<string, unknown> = pathMeta(pathInfo);

  if (!sensitive) {
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

  const pathResult = validateMutationPath(path, cwd);
  if (!pathResult.ok) {
    return { behavior: "deny", reason: pathResult.reason, metadata: pathResult.metadata };
  }

  const { pathInfo } = pathResult;

  if (classifyWriteTarget(pathInfo.absolutePath) === "directory") {
    return {
      behavior: "deny",
      reason: `cannot write file: target path is an existing directory`,
      metadata: { ...pathMeta(pathInfo), operation: "write", target: "directory" },
    };
  }

  const sensitive = isSensitivePath(pathInfo.realPath);
  const metadata: Record<string, unknown> = pathMeta(pathInfo);

  if (!sensitive) {
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

function checkApplyPatch(
  input: unknown,
  mode: ApprovalMode,
  cwd: string,
): ToolPermissionDecision {
  if (mode === "never") {
    return { behavior: "deny", reason: "patches denied in never-approval mode" };
  }

  const { patch } = input as { patch: string };
  const parsed = parsePatch(patch);
  if (!parsed.ok) {
    return { behavior: "deny", reason: `Invalid patch: ${parsed.error}` };
  }

  const { operations } = parsed;
  const resolved = resolvePatchPaths(operations, cwd);
  if (!resolved.ok) {
    return { behavior: "deny", reason: resolved.error };
  }

  const affectedPaths = operations.map((op) => op.path);
  const hasSensitive = operations.some((op) => {
    const info = resolvePathInfo(cwd, op.path);
    return info ? isSensitivePath(info.realPath) : false;
  });
  const meta = buildPatchDiffMeta(operations, cwd);
  const resolvedPathsObj: Record<string, string> = {};
  for (const [k, v] of resolved.resolved) {
    resolvedPathsObj[k] = v;
  }

  if (meta.failures.length > 0) {
    return {
      behavior: "deny",
      reason: `Patch will fail: ${meta.failures.join("; ")}`,
      resolvedInput: {
        patch,
        resolvedPaths: resolvedPathsObj,
      },
      metadata: {
        operation: "patch",
        affectedPaths,
        failures: meta.failures,
      },
    };
  }

  return {
    behavior: "ask",
    reason: "patch requires approval",
    resolvedInput: {
      patch,
      resolvedPaths: resolvedPathsObj,
    },
    metadata: {
      operation: "patch",
      affectedPaths,
      ...(hasSensitive
        ? { sensitive: true }
        : {
            diff: meta.diff,
            additions: meta.additions,
            deletions: meta.deletions,
          }),
    },
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
