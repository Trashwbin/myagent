import { PromptCursor } from "./cursor.js";
import {
  graphemeSegments,
  normalizeTerminalInput,
  stripTerminalSequences,
} from "./unicode.js";

export function applyTerminalInputChunk(
  editor: PromptCursor,
  input: string,
): PromptCursor {
  let next = editor;
  let pendingText = "";

  const flushText = () => {
    const normalized = normalizeTerminalInput(pendingText);
    pendingText = "";
    if (normalized.length > 0) {
      next = next.insert(normalized);
    }
  };

  for (const segment of graphemeSegments(stripTerminalSequences(input))) {
    if (segment === "\x7f" || segment === "\b") {
      flushText();
      next = next.backspace();
      continue;
    }
    pendingText += segment;
  }

  flushText();
  return next;
}

export function hasInlineErase(input: string): boolean {
  return input.includes("\x7f") || input.includes("\b");
}
