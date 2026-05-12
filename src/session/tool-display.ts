import { parseUnifiedDiffFiles } from "../diff/unified.js";

export type ToolDisplayFile = {
  path: string;
  additions: number;
  deletions: number;
  diff?: string;
  sensitive?: boolean;
};

export type ToolDisplay = {
  kind: "context" | "shell" | "mutation" | "generic";
  title: string;
  subtitle?: string;
  summary?: string;
  details?: string;
  files?: ToolDisplayFile[];
};

const CONTEXT_TOOLS = new Set(["Read", "read_file", "grep", "glob", "list_dir", "find_up"]);
const MUTATION_TOOLS = new Set(["edit_file", "write_file", "apply_patch"]);

export function buildToolInputDisplay(
  toolName: string,
  input: unknown,
): ToolDisplay {
  const target = toolTarget(toolName, input);
  return {
    kind: toolDisplayKind(toolName),
    title: toolDisplayTitle(toolName),
    subtitle: target || undefined,
  };
}

export function buildToolResultDisplay(
  toolName: string,
  input: unknown,
  content: string,
): ToolDisplay {
  const details = stripCheckpointMarker(content);
  const files = isMutationToolName(toolName) ? extractToolDiff(details) : [];

  if (files.length > 0) {
    return {
      kind: "mutation",
      title: toolDisplayTitle(toolName),
      subtitle: files.length === 1 ? files[0]?.path : `${files.length} files`,
      summary: summarizeDiffFiles(files),
      details,
      files,
    };
  }

  return {
    kind: toolDisplayKind(toolName),
    title: toolDisplayTitle(toolName),
    subtitle: toolTarget(toolName, input) || undefined,
    summary: summarizeToolResult(toolName, content),
    details,
  };
}

export function toolDisplayKind(toolName: string): ToolDisplay["kind"] {
  if (CONTEXT_TOOLS.has(toolName)) return "context";
  if (MUTATION_TOOLS.has(toolName)) return "mutation";
  if (toolName === "bash") return "shell";
  return "generic";
}

export function toolDisplayTitle(toolName: string): string {
  switch (toolName) {
    case "Read":
    case "read_file":
      return "Read";
    case "grep":
      return "Search";
    case "glob":
      return "Find files";
    case "find_up":
      return "Find ancestor";
    case "list_dir":
      return "List directory";
    case "bash":
      return "Bash";
    case "edit_file":
      return "Edit file";
    case "write_file":
      return "Write file";
    case "apply_patch":
      return "Apply patch";
    case "skill":
      return "Load skill";
    default:
      return toolName;
  }
}

export function toolTarget(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  if (toolName === "Read" || toolName === "read_file") {
    return String(obj.path || obj.file || "");
  }
  if (toolName === "grep") {
    const query = String(obj.query || obj.pattern || "");
    const path = String(obj.path || obj.include || "");
    return [query && `"${query}"`, path && `in ${path}`].filter(Boolean).join(" ");
  }
  if (toolName === "glob") {
    return [obj.pattern, obj.path && `in ${obj.path}`].filter(Boolean).join(" ");
  }
  if (toolName === "find_up") {
    return [obj.name, obj.start_path && `from ${obj.start_path}`].filter(Boolean).join(" ");
  }
  if (toolName === "list_dir") return String(obj.path || ".");
  if (toolName === "bash") return truncate(String(obj.command || ""), 180);
  if (toolName === "apply_patch") return summarizePatch(String(obj.patch || ""));
  if (toolName === "edit_file" || toolName === "write_file") return String(obj.path || "");
  if (toolName === "skill") return String(obj.name || "");
  return "";
}

export function summarizeToolResult(toolName: string, content: string): string {
  const text = stripCheckpointMarker(content);
  const lines = text ? text.split("\n").filter(Boolean) : [];
  if (text.startsWith("Patch validation failed before execution:")) return "validation failed";
  if (text.startsWith("Tool call denied and was not executed:")) return "not executed";
  if (text.startsWith("Error:")) return "failed";
  if (toolName === "Read" || toolName === "read_file") return `${lines.length} lines`;
  if (toolName === "grep") return `${lines.length} matches`;
  if (toolName === "glob") return `${lines.length} files`;
  if (toolName === "list_dir") return `${lines.length} entries`;
  if (toolName === "bash") {
    return lines.length <= 1 ? truncate(text || "completed", 140) : `${lines.length} lines`;
  }
  if (toolName === "skill") return text.startsWith("Error:") ? "failed" : "loaded";
  if (isMutationToolName(toolName)) return "completed";
  return lines.length ? `${lines.length} lines` : "completed";
}

export function stripCheckpointMarker(content: string): string {
  return String(content || "")
    .replace(/\n?\[checkpoint: [^\]]+\]\s*$/g, "")
    .trim();
}

export function extractToolDiff(text: string): ToolDisplayFile[] {
  const raw = String(text || "").trim();
  const index = raw.search(/^(?:--git a\/.* b\/.*\n)?--- a\//m);
  if (index < 0) return [];
  const diff = raw.slice(index).trim();
  return parseUnifiedDiffFiles(diff);
}

export { parseUnifiedDiffFiles };

export function summarizeDiffFiles(files: ToolDisplayFile[]): string {
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    additions += file.additions || 0;
    deletions += file.deletions || 0;
  }
  const prefix = files.length > 1 ? `${files.length} files ` : "";
  return `${prefix}+${additions} -${deletions}`;
}

export function mergeDiffFiles(
  existing: ToolDisplayFile[],
  incoming: ToolDisplayFile[],
): ToolDisplayFile[] {
  if (incoming.length === 0) return existing;
  const byPath = new Map(existing.map((file) => [file.path, file] as const));
  for (const file of incoming) byPath.set(file.path, file);
  return Array.from(byPath.values());
}

function summarizePatch(patch: string): string {
  const lines = String(patch || "").split("\n");
  const files: string[] = [];
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    const match = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/);
    if (match) files.push(match[1]);
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  const fileText = files.length ? files.slice(0, 2).join(", ") : "patch";
  const more = files.length > 2 ? ` +${files.length - 2} files` : "";
  return `${fileText}${more} (+${added} -${removed})`;
}

function truncate(value: string, max: number): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function isMutationToolName(toolName: string): boolean {
  return MUTATION_TOOLS.has(toolName);
}
