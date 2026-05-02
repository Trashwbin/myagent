import { parseCommandUnits } from "./command-policy.js";
import type { CommandUnit } from "./command-policy.js";

// --- Types ---

export type CommandIntent =
  | { kind: "file_discovery"; cmd: string; path?: string }
  | { kind: "content_search"; cmd: string; query?: string; path?: string }
  | { kind: "partial_read"; cmd: string; path?: string; range?: { start?: number; end?: number } }
  | { kind: "fs_primitive"; cmd: string; op: "cp" | "mv" | "mkdir" }
  | { kind: "git_read"; cmd: string; subcommand: string }
  | { kind: "exec"; cmd: string }
  | { kind: "unknown"; cmd: string };

// --- Dangerous flag detection ---

const DANGEROUS_FIND_FLAGS = new Set([
  "-exec", "-execdir", "-ok", "-okdir", "-delete",
  "-fls", "-fprint", "-fprint0", "-fprintf",
]);

const DANGEROUS_RG_FLAGS_WITH_ARGS = new Set(["--pre", "--hostname-bin"]);
const DANGEROUS_RG_FLAGS_NO_ARG = new Set(["--search-zip", "-z"]);

// --- Single-unit intent classification ---

function stripQuotes(s: string): string {
  const sq = String.fromCharCode(39);
  const dq = String.fromCharCode(34);
  if ((s.startsWith(sq) && s.endsWith(sq)) || (s.startsWith(dq) && s.endsWith(dq))) {
    return s.slice(1, -1);
  }
  return s;
}

function hasDangerousFindFlags(unit: CommandUnit): boolean {
  return unit.args.some((a) => DANGEROUS_FIND_FLAGS.has(a));
}

function hasDangerousRgFlags(unit: CommandUnit): boolean {
  for (let i = 0; i < unit.args.length; i++) {
    const arg = unit.args[i];
    if (DANGEROUS_RG_FLAGS_NO_ARG.has(arg)) return true;
    if (DANGEROUS_RG_FLAGS_WITH_ARGS.has(arg) || arg.startsWith("--pre=") || arg.startsWith("--hostname-bin=")) return true;
  }
  return false;
}

function classifySingleUnit(unit: CommandUnit): CommandIntent | null {
  const cmd = unit.command;

  // --- file_discovery: rg --files ---
  if (cmd === "rg") {
    if (hasDangerousRgFlags(unit)) return null;
    if (unit.args.some((a) => a === "--files" || a === "-f")) {
      const pathIdx = findRgFilesPath(unit.args);
      return { kind: "file_discovery", cmd: unit.raw, path: pathIdx };
    }
    // rg without --files but with -l (files-with-matches) is content_search
    // rg -n / rg default is content_search
    if (unit.args.some((a) => a === "-l" || a === "--files-with-matches")) {
      const { query, path } = extractRgQueryAndPath(unit.args);
      return { kind: "content_search", cmd: unit.raw, query, path };
    }
    const { query, path } = extractRgQueryAndPath(unit.args);
    return { kind: "content_search", cmd: unit.raw, query, path };
  }

  // --- content_search: grep ---
  if (cmd === "grep") {
    const { query, path } = extractGrepQueryAndPath(unit.args);
    return { kind: "content_search", cmd: unit.raw, query, path };
  }

  // --- partial_read: sed -n, head, tail, wc, stat ---
  if (cmd === "sed") {
    if (unit.args.some((a) => /^-i/.test(a))) return null; // sed -i is dangerous
    // sed -n '10,40p' file
    const nIdx = unit.args.indexOf("-n");
    if (nIdx !== -1 && nIdx + 1 < unit.args.length) {
      const expr = stripQuotes(unit.args[nIdx + 1]);
      const range = parseSedRange(expr);
      const path = unit.args[nIdx + 2] ? stripQuotes(unit.args[nIdx + 2]) : undefined;
      return { kind: "partial_read", cmd: unit.raw, path, range };
    }
    return null; // complex sed expression
  }

  if (cmd === "head") {
    let end: number | undefined;
    let i = 0;
    const nonFlagArgs: string[] = [];
    while (i < unit.args.length) {
      const arg = unit.args[i];
      const m = arg.match(/^-n(\d+)$/);
      if (m) { end = parseInt(m[1], 10); i++; continue; }
      if (arg === "-n" && i + 1 < unit.args.length) {
        end = parseInt(unit.args[i + 1], 10);
        i += 2;
        continue;
      }
      if (arg.startsWith("-")) { i++; continue; }
      nonFlagArgs.push(arg);
      i++;
    }
    const path = nonFlagArgs[0];
    return { kind: "partial_read", cmd: unit.raw, path: path ? stripQuotes(path) : undefined, range: { start: 1, end } };
  }

  if (cmd === "tail") {
    let count: number | undefined;
    let i = 0;
    const nonFlagArgs: string[] = [];
    while (i < unit.args.length) {
      const arg = unit.args[i];
      const m = arg.match(/^-n(\d+)$/);
      if (m) { count = parseInt(m[1], 10); i++; continue; }
      if (arg === "-n" && i + 1 < unit.args.length) {
        count = parseInt(unit.args[i + 1], 10);
        i += 2;
        continue;
      }
      if (arg.startsWith("-")) { i++; continue; }
      nonFlagArgs.push(arg);
      i++;
    }
    const range = count ? { start: -count } : undefined;
    const path = nonFlagArgs[0];
    return { kind: "partial_read", cmd: unit.raw, path: path ? stripQuotes(path) : undefined, range };
  }

  if (cmd === "wc") {
    const path = unit.args.find((a) => !a.startsWith("-"));
    return { kind: "partial_read", cmd: unit.raw, path: path ? stripQuotes(path) : undefined };
  }

  if (cmd === "stat") {
    const path = unit.args.find((a) => !a.startsWith("-"));
    return { kind: "partial_read", cmd: unit.raw, path: path ? stripQuotes(path) : undefined };
  }

  // --- fs_primitive ---
  if (cmd === "cp") return { kind: "fs_primitive", cmd: unit.raw, op: "cp" };
  if (cmd === "mv") return { kind: "fs_primitive", cmd: unit.raw, op: "mv" };
  if (cmd === "mkdir") return { kind: "fs_primitive", cmd: unit.raw, op: "mkdir" };

  // --- git_read ---
  if (cmd === "git") {
    let i = 0;
    if (unit.args[i] === "-C") i += 2;
    const sub = unit.args[i];
    if (sub === "status" || sub === "diff" || sub === "log" || sub === "show") {
      return { kind: "git_read", cmd: unit.raw, subcommand: sub };
    }
    if (sub === "branch") {
      const rest = unit.args.slice(i + 1);
      if (rest.length === 0 || rest.every((a) => a.startsWith("-"))) {
        return { kind: "git_read", cmd: unit.raw, subcommand: "branch" };
      }
    }
    return null; // write-effect git
  }

  // --- exec: known safe commands ---
  const SAFE_EXEC_COMMANDS = new Set([
    "npm", "pnpm", "yarn", "node", "python3", "python",
    "make", "cargo", "go", "dotnet",
  ]);
  if (SAFE_EXEC_COMMANDS.has(cmd)) {
    return { kind: "exec", cmd: unit.raw };
  }

  // --- read-only commands we can identify but classify as exec ---
  const READONLY_CMDS = new Set([
    "ls", "cat", "file", "pwd", "echo", "uname", "whoami", "id",
    "date", "hostname", "sw_vers", "sysctl",
    "awk", "sort", "uniq", "tr", "cut", "column",
    "find",
  ]);
  if (READONLY_CMDS.has(cmd)) {
    if (cmd === "find" && hasDangerousFindFlags(unit)) return null;
    return { kind: "exec", cmd: unit.raw };
  }

  return null; // unrecognized
}

// --- Helpers ---

function findRgFilesPath(args: string[]): string | undefined {
  let sawFiles = false;
  for (const arg of args) {
    if (arg === "--files") {
      sawFiles = true;
      continue;
    }
    if (arg.startsWith("-")) continue;
    if (sawFiles) return stripQuotes(arg);
  }
  return undefined;
}

function extractRgQueryAndPath(args: string[]): { query?: string; path?: string } {
  let query: string | undefined;
  let path: string | undefined;
  let foundQuery = false;
  for (const arg of args) {
    if (arg.startsWith("-")) continue;
    if (!foundQuery) {
      query = stripQuotes(arg);
      foundQuery = true;
    } else {
      path = stripQuotes(arg);
    }
  }
  return { query, path };
}

function extractGrepQueryAndPath(args: string[]): { query?: string; path?: string } {
  let query: string | undefined;
  let path: string | undefined;
  let foundQuery = false;
  for (const arg of args) {
    if (arg.startsWith("-")) continue;
    if (!foundQuery) {
      query = stripQuotes(arg);
      foundQuery = true;
    } else {
      path = stripQuotes(arg);
    }
  }
  return { query, path };
}

function parseSedRange(expr: string): { start?: number; end?: number } | undefined {
  // Match patterns like "10,40p", "50p"
  const rangeMatch = expr.match(/^(\d+),(\d+)p$/);
  if (rangeMatch) {
    return { start: parseInt(rangeMatch[1], 10), end: parseInt(rangeMatch[2], 10) };
  }
  const singleMatch = expr.match(/^(\d+)p$/);
  if (singleMatch) {
    const n = parseInt(singleMatch[1], 10);
    return { start: n, end: n };
  }
  return undefined;
}

// --- Pipeline intent: rg ... | head ---

function classifyPipeline(units: CommandUnit[]): CommandIntent | null {
  // rg ... | head/tail/wc/sort/uniq  → content_search
  if (units.length === 2) {
    const first = classifySingleUnit(units[0]);
    const second = units[1];
    if (first?.kind === "content_search") {
      if (["head", "tail", "wc", "sort", "uniq", "cut"].includes(second.command)) {
        return first; // still content_search, just piped through a pager
      }
    }
    // rg --files | head → file_discovery
    if (first?.kind === "file_discovery") {
      if (["head", "tail", "wc", "sort"].includes(second.command)) {
        return first;
      }
    }
  }
  return null;
}

// --- Main entry ---

export function parseCommand(command: string): CommandIntent {
  const units = parseCommandUnits(command);

  if (units.length === 0) return { kind: "unknown", cmd: command };

  // Single unit
  if (units.length === 1) {
    const intent = classifySingleUnit(units[0]);
    return intent ?? { kind: "unknown", cmd: command };
  }

  // Pipeline: check if it's a recognized pipe pattern
  const pipeIntent = classifyPipeline(units);
  if (pipeIntent) return pipeIntent;

  // Multi-unit chain: if every unit classifies safely, use first unit's intent
  const intents = units.map((u) => classifySingleUnit(u));
  if (intents.every((i) => i !== null)) {
    // Safe chain — return first unit's intent as representative
    return intents[0]!;
  }

  return { kind: "unknown", cmd: command };
}

export function intentKindLabel(intent: CommandIntent): string {
  return intent.kind;
}
