import { resolve, relative, dirname, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { realpathSync, existsSync } from "node:fs";

// --- Types ---

export type CommandEffect = "read" | "write" | "network" | "dangerous" | "unknown";

export type PathInfo = {
  raw: string;
  resolved: string;
  insideWorkspace: boolean;
};

export type CommandPolicyResult = {
  effect: CommandEffect;
  decision: "allow" | "ask" | "deny";
  reason: string;
  commands?: string[];
  paths?: PathInfo[];
};

export type CommandUnit = {
  raw: string;
  command: string;
  args: string[];
};

// --- Constants ---

const SYSTEM_INFO_COMMANDS = new Set([
  "uname",
  "sw_vers",
  "hostname",
  "whoami",
  "id",
  "date",
]);

const FILE_CLASS_COMMANDS = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "grep",
  "rg",
  "find",
  "wc",
  "file",
  "stat",
  "sed",
]);

const PIPELINE_TOOLS = new Set(["awk", "sort", "uniq", "tr", "cut", "column"]);

const SHELL_PIPELINE_TARGETS = new Set(["sh", "bash", "zsh", "fish"]);

const INTERPRETER_PIPELINE_TARGETS = new Set([
  "python",
  "python3",
  "node",
  "ruby",
  "perl",
]);

const WRITE_COMMAND_MAP: Record<string, CommandEffect> = {
  touch: "write",
  mkdir: "write",
  mv: "write",
  cp: "write",
  rm: "write",
  chmod: "write",
  chown: "write",
  tee: "write",
  curl: "network",
  wget: "network",
};

const GIT_WRITE_SUBCOMMANDS = new Set([
  "add",
  "commit",
  "checkout",
  "reset",
  "push",
  "merge",
]);

const GIT_READ_SUBCOMMANDS = new Set([
  "status",
  "diff",
  "log",
  "branch",
  "remote",
  "tag",
  "show",
  "stash",
  "describe",
]);

const FIND_FLAGS = new Set(["-L", "-P", "-H", "-O"]);

const PATH_TAKING_FLAGS: Record<string, Set<string>> = {
  grep: new Set(["-f", "--file", "--exclude-from"]),
  rg: new Set(["-f", "--file", "--ignore-file", "--exclude-from"]),
  find: new Set([
    "-newer",
    "-anewer",
    "-cnewer",
    "-samefile",
    "-path",
    "-wholename",
    "-lname",
    "-ilname",
    "-ipath",
    "-iwholename",
  ]),
  sed: new Set(["-f", "--file"]),
};

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-rf\b/, reason: "recursive force delete" },
  { pattern: /\bsudo\b/, reason: "elevated privileges" },
  { pattern: /\bchmod\s+-R\b/, reason: "recursive permission change" },
  {
    pattern: /\b(?:curl|wget)\b.*\|\s*(?:sh|bash|zsh|fish)\b/,
    reason: "remote script execution",
  },
];

// --- Tokenizing ---

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
    } else if ((ch === " " || ch === "\t") && !inSingle && !inDouble) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function stripQuotes(s: string): string {
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1);
  }
  return s;
}

// --- Parsing ---

function splitOnPipes(command: string): string[] {
  let normalized = command.replace(/\|\|/g, "\x00OR\x00");
  return normalized
    .split("|")
    .map((s) => s.replace(/\x00OR\x00/g, "||").trim())
    .filter(Boolean);
}

function splitOnChains(segment: string): string[] {
  const results: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }
    if (inSingle || inDouble) {
      current += ch;
      continue;
    }
    if (ch === ";") {
      results.push(current.trim());
      current = "";
      continue;
    }
    if (ch === "&" && segment[i + 1] === "&") {
      results.push(current.trim());
      current = "";
      i++;
      continue;
    }
    if (ch === "|" && segment[i + 1] === "|") {
      results.push(current.trim());
      current = "";
      i++;
      continue;
    }
    current += ch;
  }
  if (current.trim()) results.push(current.trim());
  return results.filter(Boolean);
}

function removeRedirectClauses(s: string): string {
  return s.replace(/\s+(?:2>>|>>|2>|&>|>(?![|&]))\s*\S+\s*$/g, "").trim();
}

export function parseCommandUnits(command: string): CommandUnit[] {
  const units: CommandUnit[] = [];
  const pipeSegments = splitOnPipes(command.trim());
  for (const pipeSeg of pipeSegments) {
    const chainSegments = splitOnChains(pipeSeg);
    for (const chainSeg of chainSegments) {
      if (!chainSeg) continue;
      const cleaned = removeRedirectClauses(chainSeg);
      const tokens = tokenize(cleaned || chainSeg);
      if (tokens.length > 0) {
        units.push({
          raw: chainSeg,
          command: tokens[0],
          args: tokens.slice(1),
        });
      }
    }
  }
  return units;
}

// --- Detection helpers ---

function hasCommandSubstitution(command: string): boolean {
  const unquoted = command.replace(/'[^']*'/g, "");
  return /\$\(/.test(unquoted) || /`/.test(unquoted);
}

function hasOutputRedirect(command: string): boolean {
  const unquoted = command.replace(/'[^']*'/g, "").replace(/"[^"]*"/g, "");
  return />>/.test(unquoted) || /(^|\s|\d)>(?!>|&|\()/.test(unquoted);
}

function hasChainOperator(command: string): boolean {
  const unquoted = command.replace(/'[^']*'/g, "").replace(/"[^"]*"/g, "");
  return /&&|\|\||;/.test(unquoted);
}

function hasPipeline(command: string): boolean {
  const unquoted = command.replace(/'[^']*'/g, "").replace(/"[^"]*"/g, "");
  const noOr = unquoted.replace(/\|\|/g, "  ");
  return /\|/.test(noOr);
}

function hasEvalFlag(unit: CommandUnit): boolean {
  return unit.args.some((a) => a === "-c" || a === "-e" || a.startsWith("--eval"));
}

// --- Path resolution ---

function expandPath(raw: string, cwd: string): string {
  let expanded = raw;
  expanded = expanded.replace(/^\$\{HOME\}/, homedir());
  expanded = expanded.replace(/^\$HOME(?![A-Za-z_])/, homedir());
  expanded = expanded.replace(/^\$\{PWD\}/, cwd);
  expanded = expanded.replace(/^\$PWD(?![A-Za-z_])/, cwd);
  if (expanded.startsWith("~/")) {
    expanded = homedir() + expanded.slice(1);
  } else if (expanded === "~") {
    expanded = homedir();
  }
  if (isAbsolute(expanded)) return expanded;
  return resolve(cwd, expanded);
}

function isInsideWorkspace(resolvedPath: string, cwd: string): boolean {
  try {
    const realCwd = realpathSync(cwd);
    if (existsSync(resolvedPath)) {
      const realPath = realpathSync(resolvedPath);
      const rel = relative(realCwd, realPath);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    }
    let checkPath = resolvedPath;
    while (checkPath !== dirname(checkPath)) {
      if (existsSync(checkPath)) {
        const realAncestor = realpathSync(checkPath);
        const rel = relative(realCwd, realAncestor);
        if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
          const remaining = relative(checkPath, resolvedPath);
          return !remaining.startsWith("..");
        }
        return false;
      }
      checkPath = dirname(checkPath);
    }
    const rel = relative(realCwd, resolvedPath);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  } catch {
    return false;
  }
}

// --- Path extraction ---

function extractPaths(unit: CommandUnit, cwd: string): PathInfo[] {
  const paths: PathInfo[] = [];
  const cmd = unit.command;
  if (!FILE_CLASS_COMMANDS.has(cmd)) return paths;
  const args = unit.args;
  const pathFlags = PATH_TAKING_FLAGS[cmd];

  function addPath(raw: string) {
    const resolved = expandPath(stripQuotes(raw), cwd);
    paths.push({ raw, resolved, insideWorkspace: isInsideWorkspace(resolved, cwd) });
  }

  function handleFlagArg(arg: string, idx: number): number {
    if (pathFlags && pathFlags.has(arg) && idx + 1 < args.length) {
      addPath(args[idx + 1]);
      return idx + 2;
    }
    const eqIdx = arg.indexOf("=");
    if (eqIdx !== -1) {
      const flagPart = arg.slice(0, eqIdx);
      if (pathFlags && pathFlags.has(flagPart)) {
        addPath(arg.slice(eqIdx + 1));
      }
    }
    return idx + 1;
  }

  if (cmd === "find") {
    let i = 0;
    let hasSearchPath = false;
    while (i < args.length && FIND_FLAGS.has(args[i])) i++;
    while (i < args.length && !args[i].startsWith("-")) {
      addPath(args[i]);
      hasSearchPath = true;
      i++;
    }
    while (i < args.length) {
      if (args[i].startsWith("-")) {
        i = handleFlagArg(args[i], i);
      } else {
        i++;
      }
    }
    if (!hasSearchPath) {
      paths.push({ raw: ".", resolved: resolve(cwd, "."), insideWorkspace: true });
    }
  } else if (cmd === "grep" || cmd === "rg") {
    let foundPattern = false;
    let i = 0;
    while (i < args.length) {
      const arg = args[i];
      if (arg.startsWith("-")) {
        i = handleFlagArg(arg, i);
      } else if (!foundPattern) {
        foundPattern = true;
        i++;
      } else {
        addPath(arg);
        i++;
      }
    }
    if (paths.length === 0) {
      paths.push({ raw: ".", resolved: resolve(cwd, "."), insideWorkspace: true });
    }
  } else {
    let i = 0;
    while (i < args.length) {
      const arg = args[i];
      if (arg.startsWith("-")) {
        i = handleFlagArg(arg, i);
      } else {
        addPath(arg);
        i++;
      }
    }
    if (paths.length === 0) {
      paths.push({ raw: ".", resolved: resolve(cwd, "."), insideWorkspace: true });
    }
  }

  return paths;
}

// --- Network output path extraction ---

function extractNetworkOutputPaths(unit: CommandUnit, cwd: string): PathInfo[] {
  const paths: PathInfo[] = [];
  const cmd = unit.command;
  if (cmd !== "curl" && cmd !== "wget") return paths;

  for (let i = 0; i < unit.args.length; i++) {
    const arg = unit.args[i];
    if (cmd === "curl") {
      if ((arg === "-o" || arg === "--output") && i + 1 < unit.args.length) {
        i++;
        const resolved = expandPath(stripQuotes(unit.args[i]), cwd);
        paths.push({
          raw: unit.args[i],
          resolved,
          insideWorkspace: isInsideWorkspace(resolved, cwd),
        });
      } else if (arg.startsWith("--output=")) {
        const val = arg.slice("--output=".length);
        const resolved = expandPath(stripQuotes(val), cwd);
        paths.push({
          raw: val,
          resolved,
          insideWorkspace: isInsideWorkspace(resolved, cwd),
        });
      } else if (arg === "-O") {
        paths.push({ raw: "-O", resolved: "", insideWorkspace: false });
      }
    } else {
      // wget
      if (arg === "-O" && i + 1 < unit.args.length) {
        i++;
        const resolved = expandPath(stripQuotes(unit.args[i]), cwd);
        paths.push({
          raw: unit.args[i],
          resolved,
          insideWorkspace: isInsideWorkspace(resolved, cwd),
        });
      } else if (arg.startsWith("--output-document=")) {
        const val = arg.slice("--output-document=".length);
        const resolved = expandPath(stripQuotes(val), cwd);
        paths.push({
          raw: val,
          resolved,
          insideWorkspace: isInsideWorkspace(resolved, cwd),
        });
      } else if (arg === "--output-document" && i + 1 < unit.args.length) {
        i++;
        const resolved = expandPath(stripQuotes(unit.args[i]), cwd);
        paths.push({
          raw: unit.args[i],
          resolved,
          insideWorkspace: isInsideWorkspace(resolved, cwd),
        });
      }
    }
  }

  return paths;
}

// --- Unit classification ---

function classifyUnit(unit: CommandUnit): {
  effect: CommandEffect;
  decision: "allow" | "ask" | "deny";
  reason: string;
  isReadOnly: boolean;
} {
  const cmd = unit.command;

  // System info
  if (SYSTEM_INFO_COMMANDS.has(cmd) || cmd === "pwd") {
    return {
      effect: "read",
      decision: "allow",
      reason: "read-only command",
      isReadOnly: true,
    };
  }

  // sysctl: allow read (-n), ask write (-w)
  if (cmd === "sysctl") {
    if (/\s-w\b/.test(unit.raw)) {
      return {
        effect: "write",
        decision: "ask",
        reason: "sysctl -w modifies kernel parameters",
        isReadOnly: false,
      };
    }
    return {
      effect: "read",
      decision: "allow",
      reason: "read-only command",
      isReadOnly: true,
    };
  }

  // echo
  if (cmd === "echo") {
    return {
      effect: "read",
      decision: "allow",
      reason: "read-only command",
      isReadOnly: true,
    };
  }

  // Git
  if (cmd === "git") {
    const sub = unit.args[0];
    if (GIT_READ_SUBCOMMANDS.has(sub)) {
      if (/\s--output(=|\s)/.test(unit.raw)) {
        return {
          effect: "write",
          decision: "ask",
          reason: "git diff --output writes files",
          isReadOnly: false,
        };
      }
      return {
        effect: "read",
        decision: "allow",
        reason: "read-only git command",
        isReadOnly: true,
      };
    }
    if (GIT_WRITE_SUBCOMMANDS.has(sub)) {
      return {
        effect: "write",
        decision: "ask",
        reason: `git ${sub} is a write-effect command`,
        isReadOnly: false,
      };
    }
  }

  // Test runners
  if (cmd === "npm" || cmd === "pnpm" || cmd === "yarn") {
    const full = unit.raw;
    if (
      /\b(test|run test)\b/.test(full) &&
      !/\binstall\b/.test(full) &&
      !/\badd\b/.test(full)
    ) {
      return {
        effect: "read",
        decision: "allow",
        reason: "test command",
        isReadOnly: true,
      };
    }
    if (/\binstall\b/.test(full) || /\badd\s/.test(full)) {
      return {
        effect: "write",
        decision: "ask",
        reason: "package install is a write-effect command",
        isReadOnly: false,
      };
    }
  }

  // Eval
  if (
    /\bnode\s+(-e|--eval)\s/.test(unit.raw) ||
    /\bpython3?\s+-c\s/.test(unit.raw) ||
    /\bperl\s+-e\s/.test(unit.raw) ||
    /\bruby\s+-e\s/.test(unit.raw)
  ) {
    return {
      effect: "unknown",
      decision: "ask",
      reason: `${cmd} eval is potentially unsafe`,
      isReadOnly: false,
    };
  }

  // Write commands
  if (WRITE_COMMAND_MAP[cmd]) {
    return {
      effect: WRITE_COMMAND_MAP[cmd],
      decision: "ask",
      reason: `${cmd} is a ${WRITE_COMMAND_MAP[cmd]}-effect command`,
      isReadOnly: false,
    };
  }

  // find with dangerous flags
  if (cmd === "find") {
    if (/\s-delete\b/.test(unit.raw)) {
      return {
        effect: "write",
        decision: "ask",
        reason: "find -delete removes files",
        isReadOnly: false,
      };
    }
    if (/\s-exec(dir)?\b/.test(unit.raw)) {
      return {
        effect: "unknown",
        decision: "ask",
        reason: "find -exec can run arbitrary commands",
        isReadOnly: false,
      };
    }
  }

  // sed with -i
  if (cmd === "sed" && /\s-i\b/.test(unit.raw)) {
    return {
      effect: "write",
      decision: "ask",
      reason: "sed -i modifies files in place",
      isReadOnly: false,
    };
  }

  // Read-only file commands
  if (FILE_CLASS_COMMANDS.has(cmd)) {
    return {
      effect: "read",
      decision: "allow",
      reason: "read-only command",
      isReadOnly: true,
    };
  }

  // Pipeline tools
  if (PIPELINE_TOOLS.has(cmd)) {
    return {
      effect: "read",
      decision: "allow",
      reason: "pipeline tool",
      isReadOnly: true,
    };
  }

  // Unknown
  return {
    effect: "unknown",
    decision: "ask",
    reason: "unrecognized command requires approval",
    isReadOnly: false,
  };
}

// --- Main analysis ---

export function analyzeCommand(
  command: string,
  options: { cwd: string },
): CommandPolicyResult {
  const normalized = command.trim();
  const cwd = options.cwd;

  // Layer 1: Dangerous patterns → deny
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(normalized)) {
      return { effect: "dangerous", decision: "deny", reason };
    }
  }

  // Layer 2: Command substitution → ask
  if (hasCommandSubstitution(normalized)) {
    return {
      effect: "write",
      decision: "ask",
      reason: "command substitution requires approval",
    };
  }

  // Layer 3: Output redirect → ask
  if (hasOutputRedirect(normalized)) {
    return {
      effect: "write",
      decision: "ask",
      reason: "output redirect requires approval",
    };
  }

  // Layer 3.5: Chain operators → ask
  if (hasChainOperator(normalized)) {
    return {
      effect: "write",
      decision: "ask",
      reason: "command chain requires approval",
    };
  }

  // Layer 4: Parse into units
  const units = parseCommandUnits(normalized);
  const commands = units.map((u) => u.command);

  // Layer 5: Pipeline interpreter targets
  if (hasPipeline(normalized)) {
    for (const unit of units) {
      if (SHELL_PIPELINE_TARGETS.has(unit.command)) {
        return {
          effect: "dangerous",
          decision: "deny",
          reason: "piping into shell is remote script execution",
          commands,
        };
      }
      if (INTERPRETER_PIPELINE_TARGETS.has(unit.command)) {
        if (hasEvalFlag(unit)) {
          return {
            effect: "unknown",
            decision: "ask",
            reason: "pipeline uses interpreter eval and requires approval",
            commands,
          };
        }
        const networkSource = units.some(
          (u) => u.command === "curl" || u.command === "wget",
        );
        if (networkSource) {
          return {
            effect: "dangerous",
            decision: "deny",
            reason: `remote content piped into ${unit.command} as script`,
            commands,
          };
        }
        return {
          effect: "unknown",
          decision: "ask",
          reason: `interpreter ${unit.command} in pipeline requires approval`,
          commands,
        };
      }
    }
  }

  // Layer 6: Classify each unit and check paths
  const allPaths: PathInfo[] = [];
  for (const unit of units) {
    const cls = classifyUnit(unit);
    let paths = extractPaths(unit, cwd);
    if (unit.command === "curl" || unit.command === "wget") {
      paths = paths.concat(extractNetworkOutputPaths(unit, cwd));
    }
    allPaths.push(...paths);

    if (cls.isReadOnly) {
      for (const p of paths) {
        if (!p.insideWorkspace) {
          return {
            effect: "read",
            decision: "ask",
            reason: `command references path outside workspace: ${p.raw}`,
            commands,
            paths: allPaths,
          };
        }
      }
    }

    if (cls.decision === "deny") {
      return {
        effect: cls.effect,
        decision: "deny",
        reason: cls.reason,
        commands,
        paths: allPaths,
      };
    }
    if (cls.decision === "ask") {
      if (cls.effect === "network") {
        const outsidePath = paths.find((p) => !p.insideWorkspace);
        if (outsidePath) {
          if (outsidePath.raw === "-O") {
            return {
              effect: "network",
              decision: "ask",
              reason: "curl -O writes file using remote filename",
              commands,
              paths: allPaths,
            };
          }
          return {
            effect: "network",
            decision: "ask",
            reason: `network command writes outside workspace: ${outsidePath.raw}`,
            commands,
            paths: allPaths,
          };
        }
      }
      return {
        effect: cls.effect,
        decision: "ask",
        reason: cls.reason,
        commands,
        paths: allPaths.length > 0 ? allPaths : undefined,
      };
    }
  }

  return {
    effect: "read",
    decision: "allow",
    reason: units.length > 1 ? "read-only pipeline" : "read-only command",
    commands,
    paths: allPaths.length > 0 ? allPaths : undefined,
  };
}
