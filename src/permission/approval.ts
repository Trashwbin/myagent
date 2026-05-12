import { randomUUID } from "node:crypto";
import type { ToolPermissionDecision } from "./policy.js";
import {
  isExternalDirectoryCapable,
  matchesExternalDirectory,
} from "./external-directory.js";

export type ApprovalResponse =
  | "allow_once"
  | "allow_for_session"
  | "allow_for_workspace"
  | "abort";

export type ApprovalRule = {
  id: string;
  workspaceRoot: string;
  toolName: string;
  pattern: string;
  action: "allow";
  scope: "session" | "workspace";
  reason?: string;
  createdAt: number;
};

export type PermissionStore = {
  findMatchingRule(
    workspaceRoot: string,
    toolName: string,
    pattern: string,
  ): { toolName: string; pattern: string } | undefined;
  listPermissionRules(
    workspaceRoot: string,
  ): Array<{ toolName: string; pattern: string }>;
  addPermissionRule(input: {
    workspaceRoot: string;
    toolName: string;
    pattern: string;
  }): string;
};

export function buildApprovalPattern(
  toolName: string,
  input: unknown,
  decision: ToolPermissionDecision,
): string | undefined {
  switch (toolName) {
    case "bash": {
      const meta = decision.metadata ?? {};
      if (meta.approvalPattern) return meta.approvalPattern as string;
      return (input as { command: string }).command ?? "";
    }
    case "Read":
    case "list_dir":
    case "grep":
    case "glob":
    case "find_up": {
      const meta = decision.metadata ?? {};
      return (meta.realPath as string) ?? (input as { path?: string }).path;
    }
    case "edit_file":
    case "write_file": {
      const meta = decision.metadata ?? {};
      return (meta.absolutePath as string) ?? (input as { path: string }).path;
    }
    case "apply_patch": {
      const meta = decision.metadata ?? {};
      const paths = meta.affectedPaths as string[] | undefined;
      return paths ? paths.sort().join(",") : "patch";
    }
    case "skill": {
      const meta = decision.metadata ?? {};
      return (meta.approvalPattern as string | undefined) ?? (input as { name?: string }).name;
    }
    default:
      return undefined;
  }
}

export function matchesApprovalRule(
  toolName: string,
  input: unknown,
  decision: ToolPermissionDecision,
  rule: { toolName: string; pattern: string },
): boolean {
  if (rule.toolName === "external_directory") {
    if (!isExternalDirectoryCapable(toolName, decision.metadata)) return false;
    if (decision.metadata?.sensitive) return false;
    const realPath =
      (decision.metadata?.realPath as string) ??
      (decision.metadata?.absolutePath as string) ??
      (decision.metadata?.effectiveCwd as string) ??
      (decision.metadata?.externalDirectoryRoot as string);
    if (!realPath) return false;
    return matchesExternalDirectory(realPath, rule.pattern);
  }
  if (rule.toolName !== toolName) return false;
  const pattern = buildApprovalPattern(toolName, input, decision);
  return pattern === rule.pattern;
}

export function createSessionRule(
  toolName: string,
  pattern: string,
  cwd: string,
  reason: string,
): ApprovalRule {
  return {
    id: randomUUID(),
    workspaceRoot: cwd,
    toolName,
    pattern,
    action: "allow",
    scope: "session",
    reason,
    createdAt: Date.now(),
  };
}
