import { z } from "zod";
import { readFile, writeFile, unlink, stat, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { readFileSync } from "node:fs";
import type { ToolDefinition, ToolContext, ToolResult } from "./tool.js";
import { resolveWorkspacePath } from "../workspace/path.js";
import { resolvePathInfo } from "../workspace/path-info.js";
import { computeDiff } from "./file-mutation.js";
import { isSensitiveReadPath } from "../permission/sensitive-paths.js";

// --- Types ---

export type PatchAdd = { type: "add"; path: string; content: string };
export type PatchHunkLine =
  | { prefix: " "; text: string }
  | { prefix: "-"; text: string }
  | { prefix: "+"; text: string };
export type PatchHunk = PatchHunkLine[];
export type PatchUpdate = { type: "update"; path: string; hunks: PatchHunk[] };
export type PatchDelete = { type: "delete"; path: string };
export type PatchOperation = PatchAdd | PatchUpdate | PatchDelete;

// --- Parser ---

export function parsePatch(
  raw: string,
): { ok: true; operations: PatchOperation[] } | { ok: false; error: string } {
  const lines = raw.split("\n");
  let i = 0;

  while (i < lines.length && lines[i].trim() === "") i++;

  if (i >= lines.length || lines[i].trim() !== "*** Begin Patch") {
    return { ok: false, error: "Patch must start with *** Begin Patch" };
  }
  i++;

  const operations: PatchOperation[] = [];
  let sawEnd = false;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "*** End Patch") {
      sawEnd = true;
      break;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }

    const addMatch = line.match(/^\*\*\* Add File:\s*(.+)$/);
    const updateMatch = line.match(/^\*\*\* Update File:\s*(.+)$/);
    const deleteMatch = line.match(/^\*\*\* Delete File:\s*(.+)$/);
    const moveMatch = line.match(/^\*\*\* Move File:\s*/i);

    if (moveMatch) {
      return {
        ok: false,
        error: "Move File is not supported. Use delete + add instead.",
      };
    }

    if (addMatch) {
      const path = addMatch[1].trim();
      i++;
      const contentLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith("***")) {
        if (lines[i].startsWith("+")) {
          contentLines.push(lines[i].slice(1));
        } else {
          contentLines.push(lines[i]);
        }
        i++;
      }
      operations.push({ type: "add", path, content: contentLines.join("\n") });
    } else if (updateMatch) {
      const path = updateMatch[1].trim();
      i++;
      const hunks: PatchHunk[] = [];

      while (i < lines.length && !lines[i].startsWith("***")) {
        if (lines[i].trim() === "@@") {
          i++;
          const hunkLines: PatchHunkLine[] = [];
          while (
            i < lines.length &&
            lines[i].trim() !== "@@" &&
            !lines[i].startsWith("***")
          ) {
            const hLine = lines[i];
            if (hLine.startsWith("-")) {
              hunkLines.push({ prefix: "-", text: hLine.slice(1) });
            } else if (hLine.startsWith("+")) {
              hunkLines.push({ prefix: "+", text: hLine.slice(1) });
            } else {
              const text = hLine.startsWith(" ") ? hLine.slice(1) : hLine;
              hunkLines.push({ prefix: " ", text });
            }
            i++;
          }
          if (hunkLines.length > 0) {
            hunks.push(hunkLines);
          }
        } else {
          i++;
        }
      }

      if (hunks.length === 0) {
        return {
          ok: false,
          error: `Update File "${path}" has no hunks. Provide at least one hunk with @@ markers.`,
        };
      }
      operations.push({ type: "update", path, hunks });
    } else if (deleteMatch) {
      operations.push({ type: "delete", path: deleteMatch[1].trim() });
      i++;
    } else {
      return { ok: false, error: `Invalid patch line: ${line}` };
    }
  }

  if (!sawEnd) {
    return { ok: false, error: "Patch must end with *** End Patch" };
  }

  if (operations.length === 0) {
    return { ok: false, error: "Patch contains no operations" };
  }

  const paths = operations.map((op) => op.path);
  const uniquePaths = new Set(paths);
  if (uniquePaths.size < paths.length) {
    return {
      ok: false,
      error: "Patch contains duplicate file paths. Each file should appear at most once.",
    };
  }

  return { ok: true, operations };
}

// --- Path validation ---

export function resolvePatchPaths(
  operations: PatchOperation[],
  cwd: string,
): { ok: true; resolved: Map<string, string> } | { ok: false; error: string } {
  const resolved = new Map<string, string>();

  for (const op of operations) {
    const { path } = op;
    if (isAbsolute(path) || path.includes("..")) {
      return { ok: false, error: `Path escapes workspace: ${path}` };
    }
    const absPath = resolveWorkspacePath(cwd, path);
    if (!absPath) {
      return { ok: false, error: `Path is outside workspace: ${path}` };
    }
    resolved.set(path, absPath);
  }

  return { ok: true, resolved };
}

// --- Hunk application ---

function splitContentLines(content: string): {
  lines: string[];
  trailingNewline: boolean;
} {
  if (content === "") return { lines: [], trailingNewline: false };
  const trailingNewline = content.endsWith("\n");
  const body = trailingNewline ? content.slice(0, -1) : content;
  return {
    lines: body === "" ? [] : body.split("\n"),
    trailingNewline,
  };
}

function joinContentLines(lines: string[], trailingNewline: boolean): string {
  const body = lines.join("\n");
  return trailingNewline && (body !== "" || lines.length > 0) ? `${body}\n` : body;
}

function buildOldNewLines(hunk: PatchHunk): { oldLines: string[]; newLines: string[] } {
  const oldLines: string[] = [];
  const newLines: string[] = [];

  for (const line of hunk) {
    if (line.prefix === " ") {
      oldLines.push(line.text);
      newLines.push(line.text);
    } else if (line.prefix === "-") {
      oldLines.push(line.text);
    } else {
      newLines.push(line.text);
    }
  }

  return { oldLines, newLines };
}

function findLineSequence(lines: string[], needle: string[], startIndex: number): number {
  if (needle.length === 0) return startIndex;

  for (let i = startIndex; i <= lines.length - needle.length; i++) {
    let matched = true;
    for (let j = 0; j < needle.length; j++) {
      if (lines[i + j] !== needle[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return i;
  }

  return -1;
}

export function applyHunks(
  content: string,
  hunks: PatchHunk[],
): { ok: true; result: string } | { ok: false; error: string } {
  const parsed = splitContentLines(content);
  let currentLines = parsed.lines;
  let cursor = 0;

  for (let h = 0; h < hunks.length; h++) {
    const { oldLines, newLines } = buildOldNewLines(hunks[h]);

    if (oldLines.length === 0 && newLines.length === 0) continue;

    const idx = findLineSequence(currentLines, oldLines, cursor);
    if (idx === -1) {
      return {
        ok: false,
        error: `Hunk ${h + 1} does not match file content`,
      };
    }

    currentLines = [
      ...currentLines.slice(0, idx),
      ...newLines,
      ...currentLines.slice(idx + oldLines.length),
    ];
    cursor = idx + newLines.length;
  }

  return { ok: true, result: joinContentLines(currentLines, parsed.trailingNewline) };
}

// --- Diff metadata builder (used by permission system) ---

export function buildPatchDiffMeta(
  operations: PatchOperation[],
  cwd: string,
): {
  affectedPaths: string[];
  diff: string;
  additions: number;
  deletions: number;
} {
  const affectedPaths: string[] = [];
  const diffParts: string[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const op of operations) {
    affectedPaths.push(op.path);
    const pathInfo = resolvePathInfo(cwd, op.path);
    const absPath = pathInfo?.absolutePath ?? join(cwd, op.path);

    if (op.type === "add") {
      const { diff, additions, deletions } = computeDiff("", op.content, op.path);
      totalAdditions += additions;
      totalDeletions += deletions;
      if (diff) diffParts.push(diff);
    } else if (op.type === "update") {
      let oldContent = "";
      try {
        oldContent = readFileSync(absPath, "utf-8");
      } catch {
        // File doesn't exist — diff from empty
      }
      const applied = applyHunks(oldContent, op.hunks);
      if (applied.ok) {
        const { diff, additions, deletions } = computeDiff(
          oldContent,
          applied.result,
          op.path,
        );
        totalAdditions += additions;
        totalDeletions += deletions;
        if (diff) diffParts.push(diff);
      }
    } else {
      let oldContent = "";
      try {
        oldContent = readFileSync(absPath, "utf-8");
      } catch {
        // already gone
      }
      const { diff, additions, deletions } = computeDiff(oldContent, "", op.path);
      totalAdditions += additions;
      totalDeletions += deletions;
      if (diff) diffParts.push(diff);
    }
  }

  return {
    affectedPaths,
    diff: diffParts.join("\n"),
    additions: totalAdditions,
    deletions: totalDeletions,
  };
}

// --- Tool definition ---

const inputSchema = z.object({
  patch: z
    .string()
    .describe("Structured patch in *** Begin Patch / *** End Patch format"),
});

const executionInputSchema = inputSchema.extend({
  resolvedPaths: z.record(z.string(), z.string()).optional(),
});

export const applyPatchTool: ToolDefinition = {
  name: "apply_patch",
  description:
    "Apply a structured multi-file patch (add, update, delete files) in one atomic operation",
  inputSchema,

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const { patch, resolvedPaths } = executionInputSchema.parse(input);

    const parsed = parsePatch(patch);
    if (!parsed.ok) {
      return { ok: false, output: `Invalid patch: ${parsed.error}` };
    }

    const { operations } = parsed;

    let pathMap: Map<string, string>;
    if (resolvedPaths && context.permissionResolved) {
      pathMap = new Map(Object.entries(resolvedPaths));
    } else {
      const resolved = resolvePatchPaths(operations, context.cwd);
      if (!resolved.ok) {
        return { ok: false, output: resolved.error };
      }
      pathMap = resolved.resolved;
    }

    // Pre-flight: validate all operations and capture old content before writing
    type PendingOp =
      | {
          type: "add";
          path: string;
          absPath: string;
          content: string;
          oldContent: string;
        }
      | {
          type: "update";
          path: string;
          absPath: string;
          newContent: string;
          oldContent: string;
        }
      | {
          type: "delete";
          path: string;
          absPath: string;
          oldContent: string;
        };

    const pending: PendingOp[] = [];

    for (const op of operations) {
      const absPath = pathMap.get(op.path);
      if (!absPath) {
        return { ok: false, output: `Could not resolve path: ${op.path}` };
      }

      if (op.type === "add") {
        try {
          await stat(absPath);
          return {
            ok: false,
            output: `Add File "${op.path}" failed: file already exists. Use Update File to modify existing files.`,
          };
        } catch {
          // File doesn't exist — OK to add
        }
        pending.push({
          type: "add",
          path: op.path,
          absPath,
          content: op.content,
          oldContent: "",
        });
      } else if (op.type === "update") {
        let oldContent: string;
        try {
          oldContent = await readFile(absPath, "utf-8");
        } catch {
          return {
            ok: false,
            output: `Update File "${op.path}" failed: file does not exist`,
          };
        }
        const applied = applyHunks(oldContent, op.hunks);
        if (!applied.ok) {
          return {
            ok: false,
            output: `Update File "${op.path}": ${applied.error}`,
          };
        }
        pending.push({
          type: "update",
          path: op.path,
          absPath,
          newContent: applied.result,
          oldContent,
        });
      } else {
        let oldContent: string;
        try {
          await stat(absPath);
          oldContent = await readFile(absPath, "utf-8");
        } catch {
          return {
            ok: false,
            output: `Delete File "${op.path}" failed: file does not exist`,
          };
        }
        pending.push({ type: "delete", path: op.path, absPath, oldContent });
      }
    }

    const rollback = async (applied: PendingOp[]): Promise<void> => {
      for (const op of [...applied].reverse()) {
        try {
          if (op.type === "add") {
            await unlink(op.absPath);
          } else {
            await mkdir(dirname(op.absPath), { recursive: true });
            await writeFile(op.absPath, op.oldContent, "utf-8");
          }
        } catch {
          // Continue best-effort rollback so one cleanup failure does not hide others.
        }
      }
    };

    // Execute all operations. If any write/delete fails, restore touched files.
    const applied: PendingOp[] = [];
    try {
      for (const op of pending) {
        if (op.type === "add" || op.type === "update") {
          await mkdir(dirname(op.absPath), { recursive: true });
          await writeFile(
            op.absPath,
            op.type === "add" ? op.content : op.newContent,
            "utf-8",
          );
        } else {
          await unlink(op.absPath);
        }
        applied.push(op);
      }
    } catch (err: any) {
      const failedOp = pending[applied.length];
      await rollback(failedOp ? [...applied, failedOp] : applied);
      return {
        ok: false,
        output: `Patch failed and was rolled back: ${err.message}`,
      };
    }

    // Update read state for written files
    if (context.readState) {
      for (const op of pending) {
        if (op.type === "add" || op.type === "update") {
          try {
            const s = await stat(op.absPath);
            context.readState.updateAfterWrite(op.absPath, s.mtimeMs);
          } catch {
            // ignore
          }
        }
      }
    }

    // Build output with per-file summary and combined diff
    const summaries: string[] = [];
    const diffParts: string[] = [];
    let totalAdd = 0;
    let totalDel = 0;

    for (const op of pending) {
      const content =
        op.type === "add" ? op.content : op.type === "update" ? op.newContent : "";
      const { diff, additions, deletions } = computeDiff(op.oldContent, content, op.path);
      totalAdd += additions;
      totalDel += deletions;
      const pathInfo = resolvePathInfo(context.cwd, op.path);
      const sensitive = pathInfo ? isSensitiveReadPath(pathInfo.realPath) : false;
      if (diff && !sensitive) diffParts.push(diff);

      if (op.type === "add") {
        summaries.push(`  added ${op.path}`);
      } else if (op.type === "update") {
        summaries.push(`  updated ${op.path} (+${additions} -${deletions})`);
      } else {
        summaries.push(`  deleted ${op.path}`);
      }
    }

    let output = `Applied patch (+${totalAdd} -${totalDel}):\n${summaries.join("\n")}`;
    if (diffParts.length > 0) {
      output += `\n\n${diffParts.join("\n")}`;
    }

    return { ok: true, output };
  },
};
