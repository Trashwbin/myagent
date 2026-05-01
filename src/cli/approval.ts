import type { ApprovalResponse } from "../permission/approval.js";

export function resolvePrimaryAnswer(
  answer: string,
  options: { allowAlways?: boolean } = {},
): "allow_once" | "always" | "abort" {
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === "" || trimmed === "y" || trimmed === "yes") return "allow_once";
  if (options.allowAlways !== false && (trimmed === "a" || trimmed === "always")) {
    return "always";
  }
  return "abort";
}

export function resolveSecondaryAnswer(answer: string): ApprovalResponse | "cancel" {
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === "s" || trimmed === "session") return "allow_for_session";
  if (trimmed === "w" || trimmed === "workspace") return "allow_for_workspace";
  return "cancel";
}
