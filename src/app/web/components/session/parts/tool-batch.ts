import type { TimelinePart, TimelineToolPart } from "../../../state/types.js";

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

  for (const tool of tools) {
    if (tool.displayKind === "context") readCount += 1;
    else if (tool.displayKind === "mutation") mutationCount += 1;
    else commandCount += 1;
  }

  const items = [
    readCount ? `explored ${readCount} ${readCount === 1 ? "file" : "files"}` : "",
    commandCount ? `ran ${commandCount} ${commandCount === 1 ? "command" : "commands"}` : "",
    mutationCount ? `edited ${mutationCount} ${mutationCount === 1 ? "file" : "files"}` : "",
  ].filter(Boolean);

  return items.join(", ");
}
