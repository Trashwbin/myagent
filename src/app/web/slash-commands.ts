export type SlashCommandId = "compact" | "revert-last" | "rewind" | "model";

export type SlashCommand = {
  id: SlashCommandId;
  name: `/${SlashCommandId}`;
  usage: string;
  description: string;
  insertText: string;
  requiresArgument?: boolean;
  argumentLabel?: string;
  picker?: "model" | "checkpoint";
  pendingMessage: (args: string) => string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "compact",
    name: "/compact",
    usage: "/compact",
    description: "Compress older transcript history into a continuation summary.",
    insertText: "/compact",
    pendingMessage: () => "Compacting older transcript messages...",
  },
  {
    id: "revert-last",
    name: "/revert-last",
    usage: "/revert-last",
    description: "Restore files from the latest mutation checkpoint in this session.",
    insertText: "/revert-last",
    pendingMessage: () => "Restoring the latest checkpoint...",
  },
  {
    id: "rewind",
    name: "/rewind",
    usage: "/rewind",
    description: "Choose a checkpoint from this session to restore.",
    insertText: "/rewind",
    picker: "checkpoint",
    pendingMessage: () => "Choose a checkpoint to restore.",
  },
  {
    id: "model",
    name: "/model",
    usage: "/model",
    description: "Choose a configured model for this session.",
    insertText: "/model",
    picker: "model",
    pendingMessage: () => "Choose a model.",
  },
];

export type ParsedSlashCommand =
  | { type: "none" }
  | { type: "unknown"; name: string; message: string }
  | { type: "incomplete"; command: SlashCommand; message: string }
  | { type: "invalid"; command: SlashCommand; message: string }
  | { type: "valid"; command: SlashCommand; args: string };

export function slashCommandQuery(value: string): string | null {
  const trimmedStart = value.replace(/^\s+/, "");
  if (!trimmedStart.startsWith("/") || trimmedStart.includes("\n")) return null;
  return trimmedStart.slice(1).toLowerCase();
}

export function matchingSlashCommands(value: string): SlashCommand[] {
  const query = slashCommandQuery(value);
  if (query === null) return [];

  const commandToken = query.split(/\s+/, 1)[0] ?? "";
  return SLASH_COMMANDS.filter((command) =>
    command.name.slice(1).startsWith(commandToken),
  );
}

export function parseSlashCommand(value: string): ParsedSlashCommand {
  const text = value.trim();
  if (!text.startsWith("/")) return { type: "none" };

  const [name = "", ...rest] = text.split(/\s+/);
  const command = SLASH_COMMANDS.find((candidate) => candidate.name === name);
  if (!command) {
    return {
      type: "unknown",
      name,
      message: `Unknown command ${name}. Type / to see available commands.`,
    };
  }

  const args = rest.join(" ").trim();
  if (command.requiresArgument && !args) {
    return {
      type: "incomplete",
      command,
      message: `${command.name} requires ${command.argumentLabel ?? "an argument"}. Usage: ${command.usage}`,
    };
  }

  if (!command.requiresArgument && args) {
    return {
      type: "invalid",
      command,
      message: `${command.name} does not take arguments. Usage: ${command.usage}`,
    };
  }

  return { type: "valid", command, args };
}
