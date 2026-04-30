import type { PermissionDecision } from "./decision.js";
import { analyzeCommand } from "./command-policy.js";

export type ApprovalMode = "auto" | "on-request" | "never";

export function checkPermission(
  toolName: string,
  input: unknown,
  mode: ApprovalMode,
): PermissionDecision {
  switch (toolName) {
    case "read_file":
      return { behavior: "allow", reason: "read operations are safe" };

    case "search":
      return { behavior: "allow", reason: "search operations are safe" };

    case "edit_file":
      if (mode === "never") {
        return { behavior: "deny", reason: "edits denied in never-approval mode" };
      }
      return { behavior: "ask", reason: "file edits require approval" };

    case "bash": {
      const command = (input as { command: string }).command ?? "";
      const policy = analyzeCommand(command);
      return { behavior: policy.decision, reason: policy.reason };
    }

    default:
      return { behavior: "deny", reason: `unknown tool: ${toolName}` };
  }
}
