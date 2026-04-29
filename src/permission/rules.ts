import type { PermissionDecision } from "./decision.js";

export type ApprovalMode = "auto" | "on-request" | "never";

const ALLOWED_BASH_COMMANDS = [
  "git status",
  "git diff",
  "rg ",
  "grep ",
  "pnpm test",
  "npm test",
  "echo ",
];

const DENIED_BASH_PATTERNS = ["rm -rf", "sudo ", "chmod -R", "curl | sh"];

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
      if (DENIED_BASH_PATTERNS.some((p) => command.includes(p))) {
        return { behavior: "deny", reason: "destructive command detected" };
      }
      if (ALLOWED_BASH_COMMANDS.some((p) => command.startsWith(p))) {
        return { behavior: "allow", reason: "safe command" };
      }
      return { behavior: "ask", reason: "command requires approval" };
    }

    default:
      return { behavior: "deny", reason: `unknown tool: ${toolName}` };
  }
}
