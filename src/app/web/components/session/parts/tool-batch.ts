import type { TimelinePart, TimelineToolPart } from "../../../state/types.js";
import type { IconName } from "../../icons/Icon.js";

export type ToolBatch =
  | { kind: "part"; part: TimelinePart }
  | { kind: "batch"; tools: TimelineToolPart[]; active: boolean };

function batchKey(tool: TimelineToolPart) {
  return tool.displayKind;
}

export function batchAssistantParts(parts: TimelinePart[]): ToolBatch[] {
  const result: ToolBatch[] = [];
  let toolBuffer: TimelineToolPart[] = [];
  let currentKey: string | null = null;

  const flush = () => {
    if (toolBuffer.length === 0) return;
    const active = toolBuffer.some((tool) =>
      tool.status === "queued" || tool.status === "running" || tool.status === "approval",
    );
    result.push({ kind: "batch", tools: toolBuffer, active });
    toolBuffer = [];
    currentKey = null;
  };

  for (const part of parts) {
    if (part.kind === "tool") {
      const key = batchKey(part);
      if (currentKey && currentKey !== key) {
        flush();
      }
      toolBuffer.push(part);
      currentKey = key;
      continue;
    }
    flush();
    result.push({ kind: "part", part });
  }

  flush();
  return result;
}

export function summarizeBatch(tools: TimelineToolPart[]) {
  let readCount = 0;
  let commandCount = 0;
  let mutationCount = 0;
  let skillCount = 0;

  for (const tool of tools) {
    if (tool.displayKind === "context") readCount += 1;
    else if (tool.displayKind === "mutation") mutationCount += 1;
    else if (tool.displayKind === "skill") skillCount += 1;
    else commandCount += 1;
  }

  const items = [
    readCount ? `explored ${readCount} ${readCount === 1 ? "file" : "files"}` : "",
    skillCount ? `loaded ${skillCount} ${skillCount === 1 ? "skill" : "skills"}` : "",
    commandCount ? `ran ${commandCount} ${commandCount === 1 ? "command" : "commands"}` : "",
    mutationCount ? `edited ${mutationCount} ${mutationCount === 1 ? "file" : "files"}` : "",
  ].filter(Boolean);

  return items.join(", ");
}

export function batchIconName(tools: TimelineToolPart[]): IconName {
  if (tools.some((tool) => tool.displayKind === "mutation")) return "pencil";
  if (tools.some((tool) => tool.displayKind === "shell")) return "terminal";
  if (tools.some((tool) => tool.displayKind === "skill")) return "skill";
  return "search";
}

export function summarizeToolTrace(tools: TimelineToolPart[]) {
  let readCount = 0;
  let browseCount = 0;
  let searchCount = 0;
  let commandCount = 0;
  let editCount = 0;
  let skillCount = 0;

  for (const tool of tools) {
    if (tool.displayKind === "skill") {
      skillCount += 1;
      continue;
    }
    if (tool.displayKind === "shell") {
      commandCount += 1;
      continue;
    }
    if (tool.displayKind === "mutation") {
      editCount += Math.max(1, tool.diffFiles?.length ?? 0);
      continue;
    }
    if (tool.toolName === "Read" || tool.toolName === "read_file") {
      readCount += 1;
      continue;
    }
    if (tool.toolName === "grep" || tool.toolName === "glob") {
      searchCount += 1;
      continue;
    }
    if (tool.displayKind === "context") {
      browseCount += 1;
    }
  }

  return [
    readCount ? `${readCount} read` : "",
    browseCount ? `${browseCount} browse` : "",
    searchCount ? `${searchCount} search` : "",
    skillCount ? `${skillCount} ${skillCount === 1 ? "skill" : "skills"}` : "",
    commandCount ? `${commandCount} ${commandCount === 1 ? "command" : "commands"}` : "",
    editCount ? `${editCount} ${editCount === 1 ? "file edited" : "files edited"}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}
