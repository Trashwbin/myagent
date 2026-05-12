import { parseUnifiedDiffFiles } from "../diff/unified.js";

export type MutationFileInfo = {
  path: string;
  additions: number;
  deletions: number;
  diff?: string;
  sensitive?: boolean;
};

export type ApprovalDisplay =
  | {
      kind: "command";
      prompt: string;
      subject: string;
      intent?: string;
      allowPatternLabel?: string;
    }
  | {
      kind: "mutation";
      prompt: string;
      files: MutationFileInfo[];
    }
  | {
      kind: "access";
      prompt: string;
      subject: string;
      scope?: string;
    };

export type ToolPermissionDecision = import("./policy.js").ToolPermissionDecision;

export function buildApprovalDisplay(
  toolName: string,
  input: unknown,
  decision: ToolPermissionDecision,
): ApprovalDisplay {
  switch (toolName) {
    case "bash":
      return buildBashDisplay(input, decision);
    case "edit_file":
      return buildEditDisplay(input, decision);
    case "write_file":
      return buildWriteDisplay(input, decision);
    case "apply_patch":
      return buildPatchDisplay(input, decision);
    case "Read":
    case "read_file":
      return buildReadDisplay(input, decision);
    case "grep":
      return buildGrepDisplay(input, decision);
    case "glob":
      return buildGlobDisplay(input, decision);
    case "list_dir":
      return buildListDirDisplay(input, decision);
    case "find_up":
      return buildFindUpDisplay(input, decision);
    case "skill":
      return buildSkillDisplay(input, decision);
    default:
      return {
        kind: "access",
        prompt: `Approve ${toolName}?`,
        subject: String((input as Record<string, unknown>)?.path ?? toolName),
      };
  }
}

function buildSkillDisplay(
  input: unknown,
  _decision: ToolPermissionDecision,
): ApprovalDisplay {
  const name = String((input as Record<string, unknown>)?.name ?? "skill");
  return {
    kind: "access",
    prompt: "Load skill?",
    subject: name,
  };
}

function buildBashDisplay(
  input: unknown,
  decision: ToolPermissionDecision,
): ApprovalDisplay {
  const command = String((input as Record<string, unknown>)?.command ?? "");
  const meta = decision.metadata ?? {};
  const intentKind = meta.intentKind as string | undefined;
  const extDirPattern = meta.externalDirectoryPattern as string | undefined;

  const tokens = shellTokens(command);
  const cmd = tokens[0] || "bash";
  const args = nonFlagArgs(tokens.slice(1));

  let prompt: string;
  let subject: string;
  let intent: string | undefined;

  if (cmd === "mkdir") {
    prompt = "Create directory?";
    subject = args.join(", ");
    intent = "filesystem";
  } else if (cmd === "cp") {
    prompt = "Copy file or directory?";
    subject = args.slice(-2).join(" → ");
    intent = "filesystem";
  } else if (cmd === "mv") {
    prompt = "Move or rename path?";
    subject = args.slice(-2).join(" → ");
    intent = "filesystem";
  } else if (cmd === "touch") {
    prompt = "Create or update file?";
    subject = args.join(", ");
    intent = "filesystem";
  } else if (cmd === "rm") {
    prompt = "Delete file or directory?";
    subject = args.join(", ");
    intent = "filesystem";
  } else if (cmd === "git") {
    const sub = tokens[1];
    prompt = `Run git ${sub}?`;
    subject = truncate(command, 220);
    intent = "git";
  } else {
    prompt = "Run shell command?";
    subject = truncate(command, 220);
    if (intentKind === "exec") {
      intent = "command";
    } else if (intentKind) {
      intent = intentKind;
    }
  }

  if (extDirPattern) {
    return {
      kind: "access",
      prompt: "Allow access outside the workspace?",
      subject: command,
      scope: String(extDirPattern),
    };
  }

  if (meta.sensitive) {
    return {
      kind: "access",
      prompt: "Allow access to sensitive content?",
      subject: command,
    };
  }

  return {
    kind: "command",
    prompt,
    subject,
    intent,
    allowPatternLabel: meta.approvalPattern
      ? String(meta.approvalPattern)
      : undefined,
  };
}

function buildEditDisplay(
  input: unknown,
  decision: ToolPermissionDecision,
): ApprovalDisplay {
  const { path } = input as { path: string };
  const meta = decision.metadata ?? {};
  const sensitive = meta.sensitive as boolean | undefined;

  if (sensitive) {
    return {
      kind: "mutation",
      prompt: "Edit sensitive file?",
      files: [{ path, additions: 0, deletions: 0, sensitive: true }],
    };
  }

  const additions = (meta.additions as number) ?? 0;
  const deletions = (meta.deletions as number) ?? 0;
  const diff = meta.diff as string | undefined;

  return {
    kind: "mutation",
    prompt: "Do you want to make these changes?",
    files: [{ path, additions, deletions, diff }],
  };
}

function buildWriteDisplay(
  input: unknown,
  decision: ToolPermissionDecision,
): ApprovalDisplay {
  const { path } = input as { path: string };
  const meta = decision.metadata ?? {};
  const sensitive = meta.sensitive as boolean | undefined;

  if (sensitive) {
    return {
      kind: "mutation",
      prompt: "Write sensitive file?",
      files: [{ path, additions: 0, deletions: 0, sensitive: true }],
    };
  }

  const additions = (meta.additions as number) ?? 0;
  const deletions = (meta.deletions as number) ?? 0;
  const diff = meta.diff as string | undefined;

  return {
    kind: "mutation",
    prompt: "Do you want to make these changes?",
    files: [{ path, additions, deletions, diff }],
  };
}

function buildPatchDisplay(
  _input: unknown,
  decision: ToolPermissionDecision,
): ApprovalDisplay {
  const meta = decision.metadata ?? {};
  const sensitive = meta.sensitive as boolean | undefined;
  const affectedPaths = meta.affectedPaths as string[] | undefined;
  const diff = meta.diff as string | undefined;
  const additions = (meta.additions as number) ?? 0;
  const deletions = (meta.deletions as number) ?? 0;

  if (sensitive) {
    return {
      kind: "mutation",
      prompt: "Apply patch to sensitive files?",
      files: (affectedPaths ?? []).map((path) => ({
        path,
        additions: 0,
        deletions: 0,
        sensitive: true,
      })),
    };
  }

  if (affectedPaths && affectedPaths.length > 0) {
    const perFile = splitDiffByFile(diff, affectedPaths);
    return {
      kind: "mutation",
      prompt: "Do you want to make these changes?",
      files: perFile.length > 0
        ? perFile
        : affectedPaths.map((path) => ({ path, additions, deletions })),
    };
  }

  return {
    kind: "mutation",
    prompt: "Do you want to make these changes?",
    files: [{ path: "patch", additions, deletions, diff }],
  };
}

function buildReadDisplay(
  input: unknown,
  decision: ToolPermissionDecision,
): ApprovalDisplay {
  const { path } = input as { path: string };
  const meta = decision.metadata ?? {};
  const sensitive = meta.sensitive as boolean | undefined;
  const extDirPattern = meta.externalDirectoryPattern as string | undefined;

  if (sensitive) {
    return {
      kind: "access",
      prompt: "Read sensitive file?",
      subject: path,
    };
  }

  if (extDirPattern) {
    return {
      kind: "access",
      prompt: "Allow access outside the workspace?",
      subject: path,
      scope: String(extDirPattern),
    };
  }

  return {
    kind: "access",
    prompt: "Read file?",
    subject: path,
  };
}

function buildGrepDisplay(
  input: unknown,
  decision: ToolPermissionDecision,
): ApprovalDisplay {
  const { path: searchPath } = input as { pattern: string; path?: string };
  const meta = decision.metadata ?? {};
  const sensitive = meta.sensitive as boolean | undefined;
  const extDirPattern = meta.externalDirectoryPattern as string | undefined;

  if (sensitive) {
    return {
      kind: "access",
      prompt: "Search sensitive path?",
      subject: searchPath ?? ".",
    };
  }

  if (extDirPattern) {
    return {
      kind: "access",
      prompt: "Allow search outside the workspace?",
      subject: searchPath ?? ".",
      scope: String(extDirPattern),
    };
  }

  return {
    kind: "access",
    prompt: "Search files?",
    subject: searchPath ?? ".",
  };
}

function buildGlobDisplay(
  input: unknown,
  decision: ToolPermissionDecision,
): ApprovalDisplay {
  const { path: searchPath } = input as { pattern: string; path?: string };
  const meta = decision.metadata ?? {};
  const extDirPattern = meta.externalDirectoryPattern as string | undefined;

  if (extDirPattern) {
    return {
      kind: "access",
      prompt: "Allow file search outside the workspace?",
      subject: searchPath ?? ".",
      scope: String(extDirPattern),
    };
  }

  return {
    kind: "access",
    prompt: "Find files?",
    subject: searchPath ?? ".",
  };
}

function buildListDirDisplay(
  input: unknown,
  decision: ToolPermissionDecision,
): ApprovalDisplay {
  const { path } = input as { path: string };
  const meta = decision.metadata ?? {};
  const extDirPattern = meta.externalDirectoryPattern as string | undefined;

  if (extDirPattern) {
    return {
      kind: "access",
      prompt: "Allow directory listing outside the workspace?",
      subject: path,
      scope: String(extDirPattern),
    };
  }

  return {
    kind: "access",
    prompt: "List directory?",
    subject: path,
  };
}

function buildFindUpDisplay(
  input: unknown,
  decision: ToolPermissionDecision,
): ApprovalDisplay {
  const { name, start_path: startPath } = input as {
    name: string;
    start_path?: string;
  };
  const meta = decision.metadata ?? {};
  const extDirPattern = meta.externalDirectoryPattern as string | undefined;

  if (extDirPattern) {
    return {
      kind: "access",
      prompt: "Allow file search outside the workspace?",
      subject: startPath ?? ".",
      scope: String(extDirPattern),
    };
  }

  return {
    kind: "access",
    prompt: "Find ancestor file?",
    subject: `${name} from ${startPath ?? "."}`,
  };
}

// --- Helpers ---

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

function shellTokens(command: string): string[] {
  const text = command.trim();
  const matches = text.match(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|[^\s]+/g) || [];
  return matches.map((part) => {
    if (
      (part.startsWith('"') && part.endsWith('"')) ||
      (part.startsWith("'") && part.endsWith("'"))
    ) {
      return part.slice(1, -1);
    }
    return part;
  });
}

function nonFlagArgs(tokens: string[]): string[] {
  return tokens.filter((token) => token && !token.startsWith("-"));
}

function splitDiffByFile(
  diff: string | undefined,
  paths: string[],
): MutationFileInfo[] {
  if (!diff || paths.length === 0) return [];
  const parsed = parseUnifiedDiffFiles(diff);
  if (parsed.length === 0) return [];
  const byPath = new Map(parsed.map((file) => [file.path, file] as const));
  return paths.flatMap((path) => {
    const file = byPath.get(path);
    return file
      ? [
          {
            path,
            additions: file.additions,
            deletions: file.deletions,
            diff: file.diff,
          },
        ]
      : [];
  });
}
