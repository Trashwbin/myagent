import { graphemeSegments } from "./editor.js";

export function stringWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    const code = char.codePointAt(0)!;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) continue;
    if (
      (code >= 0x3000 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef) ||
      (code >= 0x20000 && code <= 0x2ffff)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

export function wrapLines(text: string, maxWidth: number): string[] {
  const rawLines = text.split("\n");
  const result: string[] = [];
  for (const line of rawLines) {
    if (maxWidth <= 0 || stringWidth(line) <= maxWidth) {
      result.push(line);
      continue;
    }
    let current = "";
    let currentWidth = 0;
    for (const char of graphemeSegments(line)) {
      const cw = stringWidth(char);
      if (currentWidth + cw > maxWidth && current.length > 0) {
        result.push(current);
        current = char;
        currentWidth = cw;
      } else {
        current += char;
        currentWidth += cw;
      }
    }
    if (current.length > 0) result.push(current);
  }
  return result;
}

export type WrappedLine = {
  text: string;
  start: number;
  end: number;
};

export function wrapLinesWithOffsets(text: string, maxWidth: number): WrappedLine[] {
  const rawLines = text.split("\n");
  const result: WrappedLine[] = [];
  let baseOffset = 0;

  for (const line of rawLines) {
    if (maxWidth <= 0 || stringWidth(line) <= maxWidth) {
      result.push({
        text: line,
        start: baseOffset,
        end: baseOffset + line.length,
      });
      baseOffset += line.length + 1;
      continue;
    }

    let current = "";
    let currentWidth = 0;
    let currentStart = baseOffset;
    let currentEnd = baseOffset;

    for (const char of graphemeSegments(line)) {
      const charWidth = stringWidth(char);
      if (currentWidth + charWidth > maxWidth && current.length > 0) {
        result.push({
          text: current,
          start: currentStart,
          end: currentEnd,
        });
        current = char;
        currentWidth = charWidth;
        currentStart = currentEnd;
      } else {
        current += char;
        currentWidth += charWidth;
      }
      currentEnd += char.length;
    }

    result.push({
      text: current,
      start: currentStart,
      end: currentEnd,
    });
    baseOffset += line.length + 1;
  }

  return result.length > 0 ? result : [{ text: "", start: 0, end: 0 }];
}
