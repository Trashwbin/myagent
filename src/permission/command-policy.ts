export type CommandEffect = "read" | "write" | "network" | "dangerous" | "unknown";

export type CommandPolicyResult = {
  effect: CommandEffect;
  decision: "allow" | "ask" | "deny";
  reason: string;
};

// --- Layer 1: Always deny ---

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-rf\b/, reason: "recursive force delete" },
  { pattern: /\bsudo\b/, reason: "elevated privileges" },
  { pattern: /\bchmod\s+-R\b/, reason: "recursive permission change" },
  { pattern: /\bcurl\b.*\|\s*sh\b/, reason: "remote script execution" },
];

// --- Layer 2: Shell control operators ---

const SHELL_OPERATOR_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: />>/, label: "append redirect" },
  { pattern: />(?=>|[^>])/, label: "output redirect" },
  { pattern: /&&/, label: "command chain (&&)" },
  { pattern: /\|\|/, label: "command chain (||)" },
  { pattern: /\|/, label: "pipe" },
  { pattern: /;/, label: "command separator (;)" },
  { pattern: /\$\(/, label: "command substitution $()" },
  { pattern: /`/, label: "command substitution (backtick)" },
];

// --- Layer 3: Write-effect commands ---

const WRITE_EFFECT_PATTERNS: Array<{
  pattern: RegExp;
  effect: CommandEffect;
  reason: string;
}> = [
  {
    pattern: /\bfind\b.*\s-delete\b/,
    effect: "write",
    reason: "find -delete removes files",
  },
  {
    pattern: /\bfind\b.*\s-exec(dir)?\b/,
    effect: "unknown",
    reason: "find -exec can run arbitrary commands",
  },
  {
    pattern: /\bgit\s+diff\b.*\s--output(=|\s)/,
    effect: "write",
    reason: "git diff --output writes files",
  },
];

const WRITE_COMMAND_PREFIXES: Array<{ prefix: string; effect: CommandEffect }> = [
  { prefix: "touch ", effect: "write" },
  { prefix: "mkdir ", effect: "write" },
  { prefix: "mv ", effect: "write" },
  { prefix: "cp ", effect: "write" },
  { prefix: "rm ", effect: "write" },
  { prefix: "chmod ", effect: "write" },
  { prefix: "chown ", effect: "write" },
  { prefix: "npm install", effect: "write" },
  { prefix: "pnpm add ", effect: "write" },
  { prefix: "pnpm install", effect: "write" },
  { prefix: "yarn add ", effect: "write" },
  { prefix: "git add ", effect: "write" },
  { prefix: "git commit", effect: "write" },
  { prefix: "git checkout", effect: "write" },
  { prefix: "git reset", effect: "write" },
  { prefix: "git push", effect: "write" },
  { prefix: "git merge", effect: "write" },
  { prefix: "curl ", effect: "network" },
  { prefix: "wget ", effect: "network" },
  { prefix: "node -e ", effect: "write" },
  { prefix: "node --eval ", effect: "write" },
  { prefix: "python -c ", effect: "write" },
  { prefix: "python3 -c ", effect: "write" },
];

// --- Layer 4: Read-only commands ---

const READ_ONLY_PREFIXES = [
  "pwd",
  "ls ",
  "ls",
  "find ",
  "rg ",
  "grep ",
  "cat ",
  "sed -n ",
  "head ",
  "tail ",
  "git status",
  "git diff",
  "git log",
  "npm test",
  "pnpm test",
  "npm run test",
  "pnpm run test",
];

export function analyzeCommand(command: string): CommandPolicyResult {
  const normalized = command.trim();

  // Layer 1: Dangerous
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(normalized)) {
      return { effect: "dangerous", decision: "deny", reason };
    }
  }

  // Layer 2: Shell control operators
  for (const { pattern, label } of SHELL_OPERATOR_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        effect: "write",
        decision: "ask",
        reason: `shell control operator (${label}) requires approval`,
      };
    }
  }

  // Layer 3: Write-effect commands
  for (const { pattern, effect, reason } of WRITE_EFFECT_PATTERNS) {
    if (pattern.test(normalized)) {
      return { effect, decision: "ask", reason };
    }
  }

  for (const { prefix, effect } of WRITE_COMMAND_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      return {
        effect,
        decision: "ask",
        reason: `${prefix.trim()} is a ${effect}-effect command`,
      };
    }
  }

  // Layer 4: Read-only commands
  for (const prefix of READ_ONLY_PREFIXES) {
    if (normalized.startsWith(prefix) || normalized === prefix) {
      return { effect: "read", decision: "allow", reason: "read-only command" };
    }
  }

  // Layer 5: Unknown
  return {
    effect: "unknown",
    decision: "ask",
    reason: "unrecognized command requires approval",
  };
}
