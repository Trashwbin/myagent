import type { ToolStatus, ToolTimelineItem } from "./types.js";
import { formatToolInputSummary } from "../../cli/format-tool-input.js";

const MAX_DETAIL_LINES = 3;

export function toolDisplayName(name: string, input?: unknown): string {
  const intentKind =
    name === "bash" && input && typeof input === "object"
      ? (input as Record<string, unknown>).intentKind
      : undefined;
  return typeof intentKind === "string" ? `bash (${intentKind})` : name;
}

export function classifyResultStatus(content: string): ToolStatus {
  if (content.startsWith("Patch validation failed before execution:")) return "invalid";
  if (content.startsWith("Tool call denied and was not executed:")) return "denied";
  if (content.startsWith("Error:")) return "failed";
  return "ok";
}

export function isImportantTool(
  name: string,
  status: ToolStatus,
  sensitive?: boolean,
): boolean {
  if (status === "failed" || status === "denied" || status === "invalid" || status === "approval")
    return true;
  if (sensitive) return true;
  return name === "edit_file" || name === "write_file" || name === "apply_patch";
}

export function truncateDetail(content: string): string {
  const lines = content.split("\n");
  if (lines.length <= MAX_DETAIL_LINES) return content;
  const extra = lines.length - MAX_DETAIL_LINES;
  return lines.slice(0, MAX_DETAIL_LINES).join("\n") + `\n... +${extra} lines`;
}

export function makeToolItem(
  callId: string,
  name: string,
  input: unknown,
  options?: { sensitive?: boolean; status?: ToolStatus; detail?: string },
): ToolTimelineItem {
  const sensitive = options?.sensitive ?? false;
  const status = options?.status ?? "queued";
  const displayName = toolDisplayName(name, input);
  const summary = formatToolInputSummary(input, { sensitive });
  return {
    callId,
    name,
    displayName,
    status,
    summary,
    detail: options?.detail,
    important: isImportantTool(name, status, sensitive),
    sensitive,
  };
}

export function summarizeToolResult(
  name: string,
  content: string,
  status: ToolStatus,
  previous: ToolTimelineItem,
): string {
  if (status !== "ok") {
    const firstLine = content.split("\n")[0] ?? "";
    const prefix =
      status === "failed" ? "failed" :
      status === "invalid" ? "invalid" :
      status === "denied" ? "denied" : status;
    return `${previous.displayName} ${prefix}: ${firstLine}`;
  }

  switch (name) {
    case "read_file":
    case "Read": {
      const lines = content.split("\n").length;
      return `${previous.displayName} ${lines} line${lines !== 1 ? "s" : ""}`;
    }
    case "grep":
    case "Grep": {
      const matches = content.split("\n").filter((l) => l.trim()).length;
      return `${previous.displayName} ${matches} match${matches !== 1 ? "es" : ""}`;
    }
    case "glob":
    case "Glob": {
      const files = content.split("\n").filter((l) => l.trim()).length;
      return `${previous.displayName} ${files} file${files !== 1 ? "s" : ""}`;
    }
    case "list_dir": {
      const entries = content.split("\n").filter((l) => l.trim()).length;
      return `${previous.displayName} ${entries} entr${entries !== 1 ? "ies" : "y"}`;
    }
    case "find_up":
    case "find": {
      const trimmed = content.trim();
      return trimmed
        ? `${previous.displayName} found: ${trimmed.split("\n").length} path${trimmed.split("\n").length !== 1 ? "s" : ""}`
        : `${previous.displayName} not found`;
    }
    case "bash": {
      const lines = content.split("\n").length;
      const preview = (content.split("\n")[0] ?? "").slice(0, 60);
      return lines > 2
        ? `${previous.displayName} ${lines} lines`
        : `${previous.displayName} ${preview}`;
    }
    case "edit_file": {
      return `${previous.displayName} ok`;
    }
    case "write_file": {
      return `${previous.displayName} ok`;
    }
    case "apply_patch": {
      const lineCount = content.split("\n").length;
      return `${previous.displayName} applied ${lineCount} line${lineCount !== 1 ? "s" : ""}`;
    }
    default: {
      const firstLine = (content.split("\n")[0] ?? "").slice(0, 80);
      return firstLine
        ? `${previous.displayName} ${firstLine}`
        : `${previous.displayName} ok`;
    }
  }
}

export function summarizeToolApproval(
  name: string,
  input: unknown,
  reason: string,
  metadata?: Record<string, unknown>,
  options?: { sensitive?: boolean },
): string {
  const sensitive = options?.sensitive ?? false;
  const inp = input as Record<string, unknown> | null | undefined;

  if (name === "apply_patch" && inp?.patch && typeof inp.patch === "string") {
    const patchLines = inp.patch.split("\n");
    let additions = 0;
    let deletions = 0;
    for (const line of patchLines) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions++;
      if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    }
    const path = (inp.path as string) ?? (metadata?.realPath as string) ?? "";
    const pathStr = path ? ` ${path}` : "";
    return `+${additions} -${deletions}${pathStr}`;
  }

  if (name === "edit_file" || name === "write_file") {
    const path = inp?.path
      ? String(inp.path)
      : metadata?.realPath
        ? String(metadata.realPath)
        : "";
    return path ? `${path} — ${reason}` : reason;
  }

  if (name === "bash") {
    const displayName = toolDisplayName(name, input);
    const cmd = inp?.command ? String(inp.command).slice(0, 50) : "";
    return cmd ? `${displayName} ${cmd}` : displayName;
  }

  return formatToolInputSummary(input, { sensitive });
}
