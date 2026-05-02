import { z } from "zod";
import { readFile, writeFile, unlink, stat, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { readFileSync, statSync } from "node:fs";
import type { ToolDefinition, ToolContext, ToolResult } from "./tool.js";
import { resolveWorkspacePath } from "../workspace/path.js";
import { resolvePathInfo } from "../workspace/path-info.js";
import {
  computeDiff,
  detectLineEnding,
  normalizeToLf,
  applyLineEnding,
  type LineEnding,
} from "./file-mutation.js";
import { isSensitiveReadPath } from "../permission/sensitive-paths.js";

// --- Types ---

export type PatchAdd = { type: "add"; path: string; content: string };
export type PatchHunk = {
  changeContexts: string[];
  oldLines: string[];
  newLines: string[];
  isEndOfFile?: boolean;
};
export type PatchUpdate = { type: "update"; path: string; hunks: PatchHunk[]; movePath?: string };
export type PatchDelete = { type: "delete"; path: string };
export type PatchOperation = PatchAdd | PatchUpdate | PatchDelete;

// --- Parser ---

function parseAtLineContext(
  raw: string,
): { contexts: string[] } | { error: string } {
  // 1. Unified range header: -1,3 +1,4 @@ [context]
  const unifiedMatch = raw.match(/^-?\d+(?:,\d+)?\s+\+?\d+(?:,\d+)?\s*@@(.*)$/);
  if (unifiedMatch) {
    const after = unifiedMatch[1].trim();
    if (after) return { contexts: [after] };
    return { contexts: [] };
  }

  // 2. Closing @@: context @@ (trailing @@ with nothing after)
  const closingMatch = raw.match(/^(.+?)\s*@@\s*$/);
  if (closingMatch) {
    const ctx = closingMatch[1].trim();
    if (ctx) return { contexts: [ctx] };
    return { contexts: [] };
  }

  // 3. @@ in the middle with text after it → ambiguous → reject
  if (raw.includes("@@")) {
    return { error: `Ambiguous @@ header: "${raw}"` };
  }

  // 4. Bare context: anything after @@
  const ctx = raw.trim();
  if (ctx) return { contexts: [ctx] };
  return { contexts: [] };
}

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
    const moveFileMatch = line.match(/^\*\*\* Move File:\s*/i);

    if (moveFileMatch) {
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
        } else if (lines[i].trim() !== "") {
          return {
            ok: false,
            error: `Add File "${path}": content line does not start with "+": "${lines[i]}"`,
          };
        } else {
          contentLines.push("");
        }
        i++;
      }
      operations.push({ type: "add", path, content: contentLines.join("\n") });
    } else if (updateMatch) {
      const path = updateMatch[1].trim();
      i++;

      let movePath: string | undefined;
      if (i < lines.length && /^\*\*\* Move to:\s*/i.test(lines[i])) {
        const moveToMatch = lines[i].match(/^\*\*\* Move to:\s*(.+)$/i);
        if (!moveToMatch) {
          return {
            ok: false,
            error: `Update File "${path}": *** Move to: requires a destination path`,
          };
        }
        movePath = moveToMatch[1].trim();
        i++;
      }

      const hunks: PatchHunk[] = [];

      const isSectionEnd = (idx: number) =>
        idx >= lines.length ||
        (lines[idx].startsWith("***") && lines[idx] !== "*** End of File");

      while (!isSectionEnd(i)) {
        if (lines[i].startsWith("---") && i + 1 < lines.length && lines[i + 1].startsWith("+++")) {
          return {
            ok: false,
            error: `Update File "${path}": standard unified diff format (---/+++) is not supported. Use @@ hunks inside the patch envelope.`,
          };
        }

        if (lines[i].startsWith("@@")) {
          const contexts: string[] = [];
          while (i < lines.length && lines[i].startsWith("@@")) {
            const raw = lines[i].slice(2).trimStart();
            const ctxResult = parseAtLineContext(raw);
            if ("error" in ctxResult) {
              return { ok: false, error: `Update File "${path}": ${ctxResult.error}` };
            }
            contexts.push(...ctxResult.contexts);
            i++;
          }

          const oldLines: string[] = [];
          const newLines: string[] = [];
          let isEndOfFile = false;

          while (i < lines.length && !lines[i].startsWith("@@") && !isSectionEnd(i)) {
            if (lines[i] === "*** End of File") {
              isEndOfFile = true;
              i++;
              break;
            }
            const hLine = lines[i];
            if (hLine.startsWith("-")) {
              oldLines.push(hLine.slice(1));
            } else if (hLine.startsWith("+")) {
              newLines.push(hLine.slice(1));
            } else {
              const text = hLine.startsWith(" ") ? hLine.slice(1) : hLine;
              oldLines.push(text);
              newLines.push(text);
            }
            i++;
          }

          hunks.push({
            changeContexts: contexts,
            oldLines,
            newLines,
            isEndOfFile: isEndOfFile || undefined,
          });
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
      operations.push({ type: "update", path, hunks, movePath });
    } else if (deleteMatch) {
      operations.push({ type: "delete", path: deleteMatch[1].trim() });
      i++;
    } else if (/^\*\*\* Move to:\s*/i.test(line)) {
      return {
        ok: false,
        error: "*** Move to: is only valid after *** Update File:",
      };
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
  const movePaths = operations
    .filter((op): op is PatchUpdate & { movePath: string } => op.type === "update" && !!op.movePath)
    .map((op) => op.movePath);
  const allPaths = [...paths, ...movePaths];
  const uniquePaths = new Set(allPaths);
  if (uniquePaths.size < allPaths.length) {
    return {
      ok: false,
      error:
        "Patch contains duplicate file paths. Each file should appear at most once.",
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

    if (op.type === "update" && op.movePath) {
      if (isAbsolute(op.movePath) || op.movePath.includes("..")) {
        return { ok: false, error: `Move destination escapes workspace: ${op.movePath}` };
      }
      const absMove = resolveWorkspacePath(cwd, op.movePath);
      if (!absMove) {
        return { ok: false, error: `Move destination is outside workspace: ${op.movePath}` };
      }
      resolved.set(op.movePath, absMove);
    }
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

type Comparator = (a: string, b: string) => boolean;

function tryMatchSequence(
  lines: string[],
  pattern: string[],
  startIndex: number,
  compare: Comparator,
  eof: boolean,
): number {
  if (pattern.length === 0) return -1;

  if (eof) {
    const fromEnd = lines.length - pattern.length;
    if (fromEnd >= startIndex) {
      let matched = true;
      for (let j = 0; j < pattern.length; j++) {
        if (!compare(lines[fromEnd + j], pattern[j])) {
          matched = false;
          break;
        }
      }
      if (matched) return fromEnd;
    }
  }

  for (let i = startIndex; i <= lines.length - pattern.length; i++) {
    let matched = true;
    for (let j = 0; j < pattern.length; j++) {
      if (!compare(lines[i + j], pattern[j])) {
        matched = false;
        break;
      }
    }
    if (matched) return i;
  }

  return -1;
}

type SeekLevel = "exact" | "trimEnd" | "trim" | "collapseWhitespace";

type SeekResult = {
  index: number;
  level: SeekLevel;
};

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function seekSequence(
  lines: string[],
  pattern: string[],
  startIndex: number,
  eof = false,
): SeekResult {
  const exact = tryMatchSequence(lines, pattern, startIndex, (a, b) => a === b, eof);
  if (exact !== -1) return { index: exact, level: "exact" };

  const trimEndResult = tryMatchSequence(
    lines,
    pattern,
    startIndex,
    (a, b) => a.trimEnd() === b.trimEnd(),
    eof,
  );
  if (trimEndResult !== -1) return { index: trimEndResult, level: "trimEnd" };

  const trimResult = tryMatchSequence(
    lines,
    pattern,
    startIndex,
    (a, b) => a.trim() === b.trim(),
    eof,
  );
  if (trimResult !== -1) return { index: trimResult, level: "trim" };

  const collapseResult = tryMatchSequence(
    lines,
    pattern,
    startIndex,
    (a, b) => collapseWhitespace(a) === collapseWhitespace(b),
    eof,
  );
  if (collapseResult !== -1) {
    for (let i = startIndex; i <= lines.length - pattern.length; i++) {
      if (i === collapseResult) continue;
      let matched = true;
      for (let j = 0; j < pattern.length; j++) {
        if (collapseWhitespace(lines[i + j]) !== collapseWhitespace(pattern[j])) {
          matched = false;
          break;
        }
      }
      if (matched) return { index: -1, level: "collapseWhitespace" };
    }
    return { index: collapseResult, level: "collapseWhitespace" };
  }

  return { index: -1, level: "collapseWhitespace" };
}

function diagnoseSeekFailure(
  lines: string[],
  pattern: string[],
): {
  exactAnywhere: boolean;
  fuzzyAnywhere: boolean;
  fuzzyCount: number;
  bestFuzzyPosition: number;
  bestPartialPct: number;
  bestPartialPosition: number;
} {
  if (pattern.length === 0) {
    return {
      exactAnywhere: false,
      fuzzyAnywhere: false,
      fuzzyCount: 0,
      bestFuzzyPosition: -1,
      bestPartialPct: 0,
      bestPartialPosition: -1,
    };
  }

  let exactAnywhere = false;
  const fuzzyPositions: number[] = [];
  let bestPartial = 0;
  let bestPartialPos = -1;

  for (let i = 0; i <= lines.length - pattern.length; i++) {
    let exactMatch = true;
    let fuzzyMatch = true;
    let partialMatch = 0;
    for (let j = 0; j < pattern.length; j++) {
      if (lines[i + j] !== pattern[j]) exactMatch = false;
      if (collapseWhitespace(lines[i + j]) !== collapseWhitespace(pattern[j])) {
        fuzzyMatch = false;
      } else {
        partialMatch++;
      }
    }
    if (exactMatch) exactAnywhere = true;
    if (fuzzyMatch) fuzzyPositions.push(i);
    if (partialMatch > bestPartial) {
      bestPartial = partialMatch;
      bestPartialPos = i;
    }
  }

  return {
    exactAnywhere,
    fuzzyAnywhere: fuzzyPositions.length > 0,
    fuzzyCount: fuzzyPositions.length,
    bestFuzzyPosition: fuzzyPositions[0] ?? -1,
    bestPartialPct: bestPartial / pattern.length,
    bestPartialPosition: bestPartialPos,
  };
}

function buildContextFailureMessage(
  hunkIdx: number,
  ctx: string,
  seekCursor: number,
  lines: string[],
): string {
  const diag = diagnoseSeekFailure(lines, [ctx]);

  if (diag.exactAnywhere) {
    return (
      `Hunk ${hunkIdx}: context "${ctx}" not found after line ${seekCursor}. ` +
      "This content exists earlier in the file — a prior hunk may have shifted the cursor. " +
      "Re-read the file and adjust the patch order."
    );
  }

  if (diag.fuzzyAnywhere && diag.fuzzyCount === 1) {
    return (
      `Hunk ${hunkIdx}: context "${ctx}" not found after line ${seekCursor}. ` +
      `Similar content exists at line ${diag.bestFuzzyPosition + 1} with whitespace differences. ` +
      "Re-read the file for exact content."
    );
  }

  if (diag.fuzzyAnywhere && diag.fuzzyCount > 1) {
    return (
      `Hunk ${hunkIdx}: context "${ctx}" not found after line ${seekCursor}. ` +
      `Similar content matches at ${diag.fuzzyCount} locations. ` +
      "Add more @@ context lines to disambiguate, or re-read the file for current content."
    );
  }

  if (diag.bestPartialPct >= 0.5) {
    return (
      `Hunk ${hunkIdx}: context "${ctx}" not found after line ${seekCursor}. ` +
      `Partially matching content near line ${diag.bestPartialPosition + 1}. ` +
      "The file content may have changed. Re-read the file for current content."
    );
  }

  return (
    `Hunk ${hunkIdx}: context "${ctx}" not found after line ${seekCursor}. ` +
    "The file content may have changed. Re-read the file for current content."
  );
}

function buildOldLinesFailureMessage(
  hunkIdx: number,
  seekCursor: number,
  lastCtxIndex: number,
  lines: string[],
  oldLines: string[],
  eof: boolean,
): string {
  const ctxNote =
    lastCtxIndex >= 0 ? `context matched at line ${lastCtxIndex + 1}, ` : "";
  const eofNote = eof ? " (expected at end of file)" : "";
  const diag = diagnoseSeekFailure(lines, oldLines);

  if (diag.exactAnywhere) {
    return (
      `Hunk ${hunkIdx}: ${ctxNote}expected content not found after line ${seekCursor}${eofNote}. ` +
      "The exact content exists earlier in the file — a prior hunk may have shifted the cursor. " +
      "Re-read the file and adjust the patch order."
    );
  }

  if (diag.fuzzyAnywhere && diag.fuzzyCount === 1) {
    return (
      `Hunk ${hunkIdx}: ${ctxNote}expected content matches near line ${diag.bestFuzzyPosition + 1} ` +
      "after whitespace normalization but differs in formatting. " +
      "Re-read the file and use the exact current content."
    );
  }

  if (diag.fuzzyAnywhere && diag.fuzzyCount > 1) {
    return (
      `Hunk ${hunkIdx}: ${ctxNote}expected content partially matches at ${diag.fuzzyCount} locations. ` +
      "Add more @@ context lines to narrow the location, or re-read the file for current content."
    );
  }

  if (diag.bestPartialPct >= 0.5) {
    return (
      `Hunk ${hunkIdx}: ${ctxNote}expected content partially matches near line ${diag.bestPartialPosition + 1} ` +
      `(${Math.round(diag.bestPartialPct * 100)}% of lines). ` +
      "Some lines may have changed. Re-read the file for current content."
    );
  }

  return (
    `Hunk ${hunkIdx}: ${ctxNote}expected content not found after line ${seekCursor}${eofNote}. ` +
    "The file content may have changed since the patch was generated. Re-read the file for current content."
  );
}

export function applyHunks(
  content: string,
  hunks: PatchHunk[],
): { ok: true; result: string } | { ok: false; error: string } {
  const parsed = splitContentLines(content);
  let currentLines = parsed.lines;
  let cursor = 0;

  for (let h = 0; h < hunks.length; h++) {
    const hunk = hunks[h];
    let seekCursor = cursor;
    let lastCtxIndex = -1;

    // Seek through changeContexts
    for (const ctx of hunk.changeContexts) {
      const result = seekSequence(currentLines, [ctx], seekCursor);
      if (result.index === -1) {
        return {
          ok: false,
          error: buildContextFailureMessage(h + 1, ctx, seekCursor, currentLines),
        };
      }
      seekCursor = result.index + 1;
      lastCtxIndex = result.index;
    }

    // Insertion-only hunk (no old lines)
    if (hunk.oldLines.length === 0) {
      let insertIdx: number;
      if (hunk.newLines.length === 0) continue;

      if (hunk.changeContexts.length > 0) {
        // Insert after the last context line
        insertIdx = seekCursor;
      } else if (hunk.isEndOfFile) {
        insertIdx = currentLines.length;
      } else {
        insertIdx = currentLines.length;
      }

      currentLines = [
        ...currentLines.slice(0, insertIdx),
        ...hunk.newLines,
        ...currentLines.slice(insertIdx),
      ];
      cursor = insertIdx + hunk.newLines.length;
      continue;
    }

    // Normal replacement hunk
    const result = seekSequence(
      currentLines,
      hunk.oldLines,
      seekCursor,
      hunk.isEndOfFile ?? false,
    );
    if (result.index === -1) {
      return {
        ok: false,
        error: buildOldLinesFailureMessage(
          h + 1,
          seekCursor,
          lastCtxIndex,
          currentLines,
          hunk.oldLines,
          hunk.isEndOfFile ?? false,
        ),
      };
    }

    currentLines = [
      ...currentLines.slice(0, result.index),
      ...hunk.newLines,
      ...currentLines.slice(result.index + hunk.oldLines.length),
    ];
    cursor = result.index + hunk.newLines.length;
  }

  return { ok: true, result: joinContentLines(currentLines, parsed.trailingNewline) };
}

// --- Shared hunk application (normalizes, applies, restores line ending) ---

function tryApplyHunks(
  oldContent: string,
  hunks: PatchHunk[],
): { ok: true; result: string } | { ok: false; error: string } {
  const lineEnding: LineEnding = detectLineEnding(oldContent);
  const normalized = normalizeToLf(oldContent);
  const applied = applyHunks(normalized, hunks);
  if (!applied.ok) return applied;
  const resultContent =
    lineEnding === "crlf" ? applyLineEnding(applied.result, "crlf") : applied.result;
  return { ok: true, result: resultContent };
}

// --- Prepare / validation layer ---

export type PreparedApplyPatch = {
  patch: string;
  operations: PatchOperation[];
  resolvedPaths: Record<string, string>;
  metadata: {
    operation: "patch";
    affectedPaths: string[];
    diff?: string;
    additions?: number;
    deletions?: number;
    failures?: string[];
    moves?: Array<{ from: string; to: string }>;
    sensitive?: boolean;
  };
};

export type PrepareApplyPatchResult =
  | { kind: "invalid"; reason: string; metadata?: Record<string, unknown> }
  | { kind: "needs_approval"; prepared: PreparedApplyPatch }
  | { kind: "ready"; prepared: PreparedApplyPatch };

export function prepareApplyPatch(
  input: unknown,
  mode: string,
  cwd: string,
): PrepareApplyPatchResult {
  const { patch } = input as { patch: string };

  // Parse
  const parsed = parsePatch(patch);
  if (!parsed.ok) {
    return { kind: "invalid", reason: `Invalid patch: ${parsed.error}` };
  }

  const { operations } = parsed;

  // Resolve paths
  const resolved = resolvePatchPaths(operations, cwd);
  if (!resolved.ok) {
    return { kind: "invalid", reason: resolved.error };
  }

  // Build diff metadata + dry-run
  const meta = buildPatchDiffMeta(operations, cwd);
  const affectedPaths = meta.affectedPaths;
  const resolvedPathsObj: Record<string, string> = {};
  for (const [k, v] of resolved.resolved) {
    resolvedPathsObj[k] = v;
  }

  // If preflight found failures, the patch is invalid (not a permission issue)
  if (meta.failures.length > 0) {
    return {
      kind: "invalid",
      reason: `Patch validation failed: ${meta.failures.join("; ")}`,
      metadata: {
        operation: "patch" as const,
        affectedPaths,
        failures: meta.failures,
        ...(meta.moves.length > 0 ? { moves: meta.moves } : {}),
      },
    };
  }

  // Check sensitive paths
  const hasSensitive = operations.some((op) => {
    const info = resolvePathInfo(cwd, op.path);
    if (info ? isSensitiveReadPath(info.realPath) : false) return true;
    if (op.type === "update" && op.movePath) {
      const moveInfo = resolvePathInfo(cwd, op.movePath);
      return moveInfo ? isSensitiveReadPath(moveInfo.realPath) : false;
    }
    return false;
  });

  const prepared: PreparedApplyPatch = {
    patch,
    operations,
    resolvedPaths: resolvedPathsObj,
    metadata: {
      operation: "patch",
      affectedPaths,
      ...(meta.moves.length > 0 ? { moves: meta.moves } : {}),
      ...(hasSensitive
        ? { sensitive: true }
        : {
            diff: meta.diff,
            additions: meta.additions,
            deletions: meta.deletions,
          }),
    },
  };

  // Mode-based decision: never → deny (permission), otherwise needs approval
  if (mode === "never") {
    // This will be handled as deny by the caller
    return { kind: "needs_approval", prepared };
  }

  return { kind: "needs_approval", prepared };
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
  failures: string[];
  moves: Array<{ from: string; to: string }>;
} {
  const affectedPaths: string[] = [];
  const diffParts: string[] = [];
  const failures: string[] = [];
  const moves: Array<{ from: string; to: string }> = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const op of operations) {
    affectedPaths.push(op.path);
    const pathInfo = resolvePathInfo(cwd, op.path);
    const absPath = pathInfo?.absolutePath ?? join(cwd, op.path);
    const sensitive = pathInfo ? isSensitiveReadPath(pathInfo.realPath) : false;

    if (op.type === "add") {
      if (sensitive) continue;
      try {
        statSync(absPath);
        failures.push(
          `Add File "${op.path}": file already exists. Use Update File to modify existing files.`,
        );
        continue;
      } catch {
        // File doesn't exist — OK to add
      }
      const { diff, additions, deletions } = computeDiff("", op.content, op.path);
      totalAdditions += additions;
      totalDeletions += deletions;
      if (diff) diffParts.push(diff);
    } else if (op.type === "update") {
      if (op.movePath) {
        affectedPaths.push(op.movePath);
        moves.push({ from: op.path, to: op.movePath });
        if (!sensitive) {
          const moveInfo = resolvePathInfo(cwd, op.movePath);
          const absMove = moveInfo?.absolutePath ?? join(cwd, op.movePath);
          try {
            const s = statSync(absMove);
            if (s.isDirectory()) {
              failures.push(`Move to "${op.movePath}": destination is an existing directory`);
            } else {
              failures.push(`Move to "${op.movePath}": destination file already exists`);
            }
          } catch {
            // Destination doesn't exist — OK
          }
        }
      }
      if (sensitive) continue;
      let oldContent = "";
      try {
        oldContent = readFileSync(absPath, "utf-8");
      } catch {
        failures.push(`Update File "${op.path}": file does not exist`);
        continue;
      }
      const applied = tryApplyHunks(oldContent, op.hunks);
      if (!applied.ok) {
        failures.push(`Update File "${op.path}": ${applied.error}`);
      } else {
        const displayPath = op.movePath ?? op.path;
        const { diff, additions, deletions } = computeDiff(oldContent, applied.result, displayPath);
        totalAdditions += additions;
        totalDeletions += deletions;
        if (diff) diffParts.push(diff);
      }
    } else {
      if (sensitive) continue;
      let oldContent = "";
      try {
        oldContent = readFileSync(absPath, "utf-8");
      } catch {
        failures.push(`Delete File "${op.path}": file does not exist`);
        continue;
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
    failures,
    moves,
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
  description: `Apply a structured multi-file patch (add, update, delete files) in one atomic operation.

Recovery rules:
- If apply_patch returns a validation failure that mentions "re-read", "content may have changed", or "context not found", Read the affected file.
- After reading, you MUST regenerate a new patch based on the current file content and retry apply_patch. Reading is a recovery step, not the final action.
- Do not end your turn after a Read that was triggered by a patch failure without attempting a new patch or explaining why the task cannot continue.`,
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
          type: "move";
          path: string;
          absPath: string;
          movePath: string;
          absMovePath: string;
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
        const applied = tryApplyHunks(oldContent, op.hunks);
        if (!applied.ok) {
          return {
            ok: false,
            output: `Update File "${op.path}": ${applied.error}`,
          };
        }

        if (op.movePath) {
          const absMovePath = pathMap.get(op.movePath);
          if (!absMovePath) {
            return { ok: false, output: `Could not resolve move destination: ${op.movePath}` };
          }
          try {
            const destStat = await stat(absMovePath);
            if (destStat.isDirectory()) {
              return { ok: false, output: `Move to "${op.movePath}" failed: destination is an existing directory` };
            }
            return { ok: false, output: `Move to "${op.movePath}" failed: destination file already exists` };
          } catch {
            // Destination doesn't exist — OK
          }
          pending.push({
            type: "move",
            path: op.path,
            absPath,
            movePath: op.movePath,
            absMovePath,
            newContent: applied.result,
            oldContent,
          });
        } else {
          pending.push({
            type: "update",
            path: op.path,
            absPath,
            newContent: applied.result,
            oldContent,
          });
        }
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
          } else if (op.type === "move") {
            await unlink(op.absMovePath);
            await mkdir(dirname(op.absPath), { recursive: true });
            await writeFile(op.absPath, op.oldContent, "utf-8");
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
        } else if (op.type === "move") {
          await mkdir(dirname(op.absMovePath), { recursive: true });
          await writeFile(op.absMovePath, op.newContent, "utf-8");
          await unlink(op.absPath);
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
            const info = resolvePathInfo(context.cwd, op.path);
            const key = info?.realPath ?? op.absPath;
            context.readState.updateAfterWrite(key, s.mtimeMs);
          } catch {
            // ignore
          }
        } else if (op.type === "move") {
          try {
            const s = await stat(op.absMovePath);
            const destInfo = resolvePathInfo(context.cwd, op.movePath);
            const destKey = destInfo?.realPath ?? op.absMovePath;
            context.readState.updateAfterWrite(destKey, s.mtimeMs);
          } catch {
            // ignore
          }
          const srcInfo = resolvePathInfo(context.cwd, op.path);
          context.readState.remove(srcInfo?.realPath ?? op.absPath);
        }
      }
    }

    // Build output with per-file summary and combined diff
    const summaries: string[] = [];
    const diffParts: string[] = [];
    let totalAdd = 0;
    let totalDel = 0;

    for (const op of pending) {
      if (op.type === "delete") {
        const { diff, additions, deletions } = computeDiff(op.oldContent, "", op.path);
        totalAdd += additions;
        totalDel += deletions;
        const pathInfo = resolvePathInfo(context.cwd, op.path);
        const sensitive = pathInfo ? isSensitiveReadPath(pathInfo.realPath) : false;
        if (diff && !sensitive) diffParts.push(diff);
        summaries.push(`  deleted ${op.path}`);
      } else if (op.type === "move") {
        const displayPath = `${op.path} -> ${op.movePath}`;
        const { diff, additions, deletions } = computeDiff(op.oldContent, op.newContent, displayPath);
        totalAdd += additions;
        totalDel += deletions;
        const pathInfo = resolvePathInfo(context.cwd, op.path);
        const sensitive = pathInfo ? isSensitiveReadPath(pathInfo.realPath) : false;
        if (diff && !sensitive) diffParts.push(diff);
        summaries.push(`  moved ${displayPath} (+${additions} -${deletions})`);
      } else {
        const content = op.type === "add" ? op.content : op.newContent;
        const { diff, additions, deletions } = computeDiff(op.oldContent, content, op.path);
        totalAdd += additions;
        totalDel += deletions;
        const pathInfo = resolvePathInfo(context.cwd, op.path);
        const sensitive = pathInfo ? isSensitiveReadPath(pathInfo.realPath) : false;
        if (diff && !sensitive) diffParts.push(diff);

        if (op.type === "add") {
          summaries.push(`  added ${op.path}`);
        } else {
          summaries.push(`  updated ${op.path} (+${additions} -${deletions})`);
        }
      }
    }

    let output = `Applied patch (+${totalAdd} -${totalDel}):\n${summaries.join("\n")}`;
    if (diffParts.length > 0) {
      output += `\n\n${diffParts.join("\n")}`;
    }

    return { ok: true, output };
  },
};
