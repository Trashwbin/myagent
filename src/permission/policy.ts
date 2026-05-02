import { checkReadPolicy, isSensitiveReadPath } from "./read-policy.js";
import { analyzeCommand } from "./command-policy.js";
import { buildExternalDirectoryMeta } from "./external-directory.js";
import {
  prepareApplyPatch,
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
  behavior: "allow" | "ask" | "deny" | "invalid";
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
    case "Read":
      return finalize(checkRead(input, cwd));
    case "list_dir":
      return finalize(checkListDir(input, cwd));
    case "grep":
      return finalize(checkGrep(input, cwd));
    case "glob":
      return finalize(checkGlob(input, cwd));
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

function checkRead(input: unknown, cwd: string): ToolPermissionDecision {
  const { path, offset, limit } = input as { path: string; offset?: number; limit?: number };
  const policy = checkReadPolicy(cwd, path);
  const sensitive = isSensitiveReadPath(policy.pathInfo.realPath);
  const metadata: Record<string, unknown> = {
    ...pathMeta(policy.pathInfo),
    sensitive,
  };
  if (!policy.pathInfo.insideWorkspace && !sensitive) {
    Object.assign(
      metadata,
      buildExternalDirectoryMeta("Read", policy.pathInfo.realPath),
    );
  }
  return {
    behavior: policy.behavior,
    reason: policy.reason,
    resolvedInput: {
      path,
      offset,
      limit,
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

function checkGrep(input: unknown, cwd: string): ToolPermissionDecision {
  const {
    pattern,
    path: searchPath = ".",
    include,
    exclude = [],
    max_results = 200,
    before_context,
    after_context,
  } = input as {
    pattern: string;
    path?: string;
    include?: string;
    exclude?: string[];
    max_results?: number;
    before_context?: number;
    after_context?: number;
  };
  const policy = checkReadPolicy(cwd, searchPath);
  const sensitive = isSensitiveReadPath(policy.pathInfo.realPath);

  const reasonMap: Record<string, string> = {
    "sensitive file read requires approval":
      "sensitive path search requires approval",
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
      buildExternalDirectoryMeta("grep", policy.pathInfo.realPath),
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
      include,
      exclude,
      max_results,
      before_context,
      after_context,
    },
    metadata,
  };
}

function checkGlob(input: unknown, cwd: string): ToolPermissionDecision {
  const {
    pattern,
    path: searchPath = ".",
    limit = 100,
  } = input as {
    pattern: string;
    path?: string;
    limit?: number;
  };
  const policy = checkReadPolicy(cwd, searchPath);
  const sensitive = isSensitiveReadPath(policy.pathInfo.realPath);

  const metadata: Record<string, unknown> = {
    ...pathMeta(policy.pathInfo),
    sensitive,
  };
  if (!policy.pathInfo.insideWorkspace && !sensitive) {
    Object.assign(
      metadata,
      buildExternalDirectoryMeta("glob", policy.pathInfo.realPath),
    );
  }

  return {
    behavior: policy.behavior,
    reason: policy.reason,
    resolvedInput: {
      pattern,
      path: searchPath,
      limit,
      resolvedPath: policy.pathInfo.absolutePath,
      realPath: policy.pathInfo.realPath,
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

  const result = prepareApplyPatch(input, mode, cwd);

  if (result.kind === "invalid") {
    return {
      behavior: "invalid",
      reason: result.reason,
      metadata: result.metadata,
    };
  }

  return {
    behavior: "ask",
    reason: "patch requires approval",
    resolvedInput: {
      patch: result.prepared.patch,
      resolvedPaths: result.prepared.resolvedPaths,
    },
    metadata: result.prepared.metadata,
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
