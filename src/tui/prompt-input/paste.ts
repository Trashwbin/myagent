import type { PastePart, PromptState } from "../types.js";

export function normalizePaste(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function nextPastePartId(parts: PastePart[]): number {
  return parts.reduce((max, part) => Math.max(max, part.id), 0) + 1;
}

export function summarizePaste(
  text: string,
  id = 1,
): { display: string; part: PastePart } | null {
  const normalized = normalizePaste(text);
  const lineCount = (normalized.match(/\n/g)?.length ?? 0) + 1;
  if (lineCount < 3 && normalized.length <= 150) return null;
  const virtualText = `[Pasted #${id} ~${lineCount} lines]`;
  return { display: virtualText, part: { id, text: normalized, virtualText } };
}

export function expandPromptText(state: PromptState): string {
  let text = state.input;
  const sorted = [...state.parts].sort((a, b) => {
    const ai = state.input.indexOf(a.virtualText);
    const bi = state.input.indexOf(b.virtualText);
    return bi - ai;
  });
  for (const part of sorted) {
    text = text.replace(part.virtualText, part.text);
  }
  return text;
}
