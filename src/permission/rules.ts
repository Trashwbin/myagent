import type { PermissionDecision } from "./decision.js";
import { checkToolPermission } from "./policy.js";
import type { ApprovalMode } from "./policy.js";

export type { ApprovalMode };

export function checkPermission(
  toolName: string,
  input: unknown,
  mode: ApprovalMode,
  cwd: string,
): PermissionDecision {
  const decision = checkToolPermission(toolName, input, mode, cwd);
  return { behavior: decision.behavior, reason: decision.reason };
}
