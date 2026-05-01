import { basename } from "node:path";

// --- Read state tracking ---

export type ReadFileState = {
  path: string;
  realPath: string;
  mtimeMs: number;
  readAt: number;
  partial: boolean;
};

export class ReadStateTracker {
  private states = new Map<string, ReadFileState>();

  record(state: ReadFileState): void {
    this.states.set(state.realPath, state);
  }

  get(realPath: string): ReadFileState | undefined {
    return this.states.get(realPath);
  }

  hasFullRead(realPath: string): boolean {
    const s = this.states.get(realPath);
    return !!s && !s.partial;
  }

  updateAfterWrite(realPath: string, mtimeMs: number): void {
    const existing = this.states.get(realPath);
    if (existing) {
      existing.mtimeMs = mtimeMs;
      existing.readAt = Date.now();
    } else {
      this.states.set(realPath, {
        path: realPath,
        realPath,
        mtimeMs,
        readAt: Date.now(),
        partial: false,
      });
    }
  }
}

// --- Line ending utilities ---

export type LineEnding = "lf" | "crlf";

export function detectLineEnding(content: string): LineEnding {
  return content.includes("\r\n") ? "crlf" : "lf";
}

export function normalizeToLf(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

export function applyLineEnding(content: string, ending: LineEnding): string {
  if (ending === "crlf") return content.replace(/\n/g, "\r\n");
  return content;
}

// --- Diff generation ---

export type DiffResult = {
  diff: string;
  additions: number;
  deletions: number;
};

type DiffOp = { type: "equal" | "delete" | "insert"; line: string };

function lcsDiff(oldLines: string[], newLines: string[]): DiffOp[] {
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const ops: DiffOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: "equal", line: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: "insert", line: newLines[j - 1] });
      j--;
    } else {
      ops.push({ type: "delete", line: oldLines[i - 1] });
      i--;
    }
  }
  ops.reverse();
  return ops;
}

function simpleDiff(oldLines: string[], newLines: string[]): DiffOp[] {
  const ops: DiffOp[] = [];
  for (const line of oldLines) ops.push({ type: "delete", line });
  for (const line of newLines) ops.push({ type: "insert", line });
  return ops;
}

function diffLines(oldLines: string[], newLines: string[]): DiffOp[] {
  let prefixLen = 0;
  while (
    prefixLen < oldLines.length &&
    prefixLen < newLines.length &&
    oldLines[prefixLen] === newLines[prefixLen]
  ) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < oldLines.length - prefixLen &&
    suffixLen < newLines.length - prefixLen &&
    oldLines[oldLines.length - 1 - suffixLen] ===
      newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const ops: DiffOp[] = [];
  for (let i = 0; i < prefixLen; i++) {
    ops.push({ type: "equal", line: oldLines[i] });
  }

  const oldMid = oldLines.slice(prefixLen, oldLines.length - suffixLen);
  const newMid = newLines.slice(prefixLen, newLines.length - suffixLen);
  if (oldMid.length * newMid.length <= 4_000_000) {
    ops.push(...lcsDiff(oldMid, newMid));
  } else {
    ops.push(...simpleDiff(oldMid, newMid));
  }

  for (let i = oldLines.length - suffixLen; i < oldLines.length; i++) {
    ops.push({ type: "equal", line: oldLines[i] });
  }
  return ops;
}

type Hunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
};

const CONTEXT_LINES = 3;
const MAX_DIFF_LINES = 200;

function groupHunks(ops: DiffOp[], context: number): Hunk[] {
  const changes: number[] = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type !== "equal") changes.push(i);
  }
  if (changes.length === 0) return [];

  const hunks: Hunk[] = [];
  let groupStart = changes[0];
  let groupEnd = changes[0];

  for (let ci = 1; ci < changes.length; ci++) {
    const nextChange = changes[ci];
    if (nextChange - groupEnd <= context * 2) {
      groupEnd = nextChange;
    } else {
      hunks.push(buildHunk(ops, groupStart, groupEnd, context));
      groupStart = nextChange;
      groupEnd = nextChange;
    }
  }
  hunks.push(buildHunk(ops, groupStart, groupEnd, context));
  return hunks;
}

function buildHunk(ops: DiffOp[], start: number, end: number, context: number): Hunk {
  const ctxStart = Math.max(0, start - context);
  const ctxEnd = Math.min(ops.length - 1, end + context);

  let oldLine = 0;
  let newLine = 0;
  for (let i = 0; i < ctxStart; i++) {
    if (ops[i].type === "delete" || ops[i].type === "equal") oldLine++;
    if (ops[i].type === "insert" || ops[i].type === "equal") newLine++;
  }

  const hunkOldStart = oldLine + 1;
  const hunkNewStart = newLine + 1;
  let oldCount = 0;
  let newCount = 0;
  const lines: string[] = [];

  for (let i = ctxStart; i <= ctxEnd; i++) {
    const op = ops[i];
    switch (op.type) {
      case "equal":
        lines.push(` ${op.line}`);
        oldCount++;
        newCount++;
        break;
      case "delete":
        lines.push(`-${op.line}`);
        oldCount++;
        break;
      case "insert":
        lines.push(`+${op.line}`);
        newCount++;
        break;
    }
  }

  return { oldStart: hunkOldStart, oldCount, newStart: hunkNewStart, newCount, lines };
}

export function computeDiff(
  oldContent: string,
  newContent: string,
  filePath: string,
): DiffResult {
  if (oldContent === newContent) {
    return { diff: "", additions: 0, deletions: 0 };
  }

  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  // Remove trailing empty element from split if content ends with \n
  if (oldContent.endsWith("\n") && oldLines[oldLines.length - 1] === "") oldLines.pop();
  if (newContent.endsWith("\n") && newLines[newLines.length - 1] === "") newLines.pop();

  const ops = diffLines(oldLines, newLines);
  const hunks = groupHunks(ops, CONTEXT_LINES);

  let additions = 0;
  let deletions = 0;
  for (const op of ops) {
    if (op.type === "insert") additions++;
    if (op.type === "delete") deletions++;
  }

  const name = basename(filePath);
  const header = `--- a/${name}\n+++ b/${name}`;
  let diffText = header;

  let lineCount = 0;
  for (const hunk of hunks) {
    if (lineCount >= MAX_DIFF_LINES) break;
    const remaining = MAX_DIFF_LINES - lineCount;
    const hunkLines =
      hunk.lines.length <= remaining ? hunk.lines : hunk.lines.slice(0, remaining);
    diffText += `\n@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
    for (const line of hunkLines) {
      diffText += `\n${line}`;
    }
    lineCount += hunk.lines.length;
  }

  if (lineCount >= MAX_DIFF_LINES) {
    diffText += `\n... (${additions} additions, ${deletions} deletions total, diff truncated)`;
  }

  return { diff: diffText, additions, deletions };
}
