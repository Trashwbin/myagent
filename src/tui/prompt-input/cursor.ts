import {
  displayWidthOfPrefix,
  graphemeSegments,
  nextGraphemeOffset,
  offsetAtDisplayColumn,
  previousGraphemeOffset,
  snapToGraphemeBoundary,
  stringWidth,
  wordBoundaries,
} from "./unicode.js";
import { wrapLinesWithOffsets, type WrappedLine } from "./width.js";

export type CursorPosition = {
  line: number;
  column: number;
};

export type CursorState = {
  value: string;
  cursor: number;
};

export class PromptCursor {
  readonly value: string;
  readonly cursor: number;

  private readonly columns: number;
  private wrappedLinesCache: WrappedLine[] | undefined;

  private constructor(value: string, columns: number, cursor: number) {
    const rawCursor = Math.max(0, Math.min(value.length, cursor));
    this.value = value.normalize("NFC");
    this.columns = Math.max(1, columns);
    this.cursor = snapToGraphemeBoundary(
      this.value,
      value.slice(0, rawCursor).normalize("NFC").length,
    );
  }

  static from(value: string, columns: number, cursor = 0): PromptCursor {
    return new PromptCursor(value, columns, cursor);
  }

  toState(): CursorState {
    return { value: this.value, cursor: this.cursor };
  }

  equals(other: PromptCursor): boolean {
    return this.value === other.value && this.cursor === other.cursor;
  }

  isAtStart(): boolean {
    return this.cursor === 0;
  }

  isAtEnd(): boolean {
    return this.cursor >= this.value.length;
  }

  insert(text: string): PromptCursor {
    const normalized = text.normalize("NFC");
    const value =
      this.value.slice(0, this.cursor) + normalized + this.value.slice(this.cursor);
    return new PromptCursor(value, this.columns, this.cursor + normalized.length);
  }

  replace(end: PromptCursor, text = ""): PromptCursor {
    const startOffset = Math.min(this.cursor, end.cursor);
    const endOffset = Math.max(this.cursor, end.cursor);
    const normalized = text.normalize("NFC");
    const value =
      this.value.slice(0, startOffset) + normalized + this.value.slice(endOffset);
    return new PromptCursor(value, this.columns, startOffset + normalized.length);
  }

  left(): PromptCursor {
    return new PromptCursor(
      this.value,
      this.columns,
      previousGraphemeOffset(this.value, this.cursor),
    );
  }

  right(): PromptCursor {
    return new PromptCursor(
      this.value,
      this.columns,
      nextGraphemeOffset(this.value, this.cursor),
    );
  }

  backspace(): PromptCursor {
    if (this.isAtStart()) return this;
    return this.left().replace(this);
  }

  deleteForward(): PromptCursor {
    if (this.isAtEnd()) return this;
    return this.replace(this.right());
  }

  startOfLine(): PromptCursor {
    const position = this.getPosition();
    if (position.column === 0 && position.line > 0) {
      return this.withPosition({ line: position.line - 1, column: 0 });
    }
    return this.withPosition({ line: position.line, column: 0 });
  }

  endOfLine(): PromptCursor {
    const position = this.getPosition();
    const line = this.getLine(position.line);
    return new PromptCursor(this.value, this.columns, line.end);
  }

  up(): PromptCursor {
    const position = this.getPosition();
    if (position.line === 0) return this;
    return this.withPosition({
      line: position.line - 1,
      column: position.column,
    });
  }

  down(): PromptCursor {
    const position = this.getPosition();
    if (position.line >= this.getWrappedLines().length - 1) return this;
    return this.withPosition({
      line: position.line + 1,
      column: position.column,
    });
  }

  deleteToLineStart(): PromptCursor {
    if (this.cursor > 0 && this.value[this.cursor - 1] === "\n") {
      return this.left().replace(this);
    }
    return this.startOfLine().replace(this);
  }

  deleteToLineEnd(): PromptCursor {
    if (this.value[this.cursor] === "\n") {
      return this.replace(this.right());
    }
    return this.replace(this.endOfLine());
  }

  deleteWordBefore(): PromptCursor {
    if (this.isAtStart()) return this;
    const target = this.previousWordStart();
    return new PromptCursor(this.value, this.columns, target).replace(this);
  }

  previousWord(): PromptCursor {
    return new PromptCursor(this.value, this.columns, this.previousWordStart());
  }

  nextWord(): PromptCursor {
    if (this.isAtEnd()) return this;
    for (const boundary of wordBoundaries(this.value)) {
      if (boundary.isWordLike && boundary.start > this.cursor) {
        return new PromptCursor(this.value, this.columns, boundary.start);
      }
    }
    return new PromptCursor(this.value, this.columns, this.value.length);
  }

  deleteWordAfter(): PromptCursor {
    if (this.isAtEnd()) return this;
    return this.replace(this.nextWord());
  }

  getPosition(): CursorPosition {
    const lines = this.getWrappedLines();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const next = lines[i + 1];
      if (this.cursor >= line.start && (!next || this.cursor < next.start)) {
        return {
          line: i,
          column: displayWidthOfPrefix(line.text, Math.max(0, this.cursor - line.start)),
        };
      }
    }
    const lastIndex = Math.max(0, lines.length - 1);
    const last = lines[lastIndex]!;
    return { line: lastIndex, column: stringWidth(last.text) };
  }

  getViewport(maxVisibleLines: number): {
    lines: WrappedLine[];
    startLine: number;
    cursorLine: number;
  } {
    const allLines = this.getWrappedLines();
    const cursorLine = this.getPosition().line;
    if (allLines.length <= maxVisibleLines) {
      return { lines: allLines, startLine: 0, cursorLine };
    }

    const half = Math.floor(maxVisibleLines / 2);
    let startLine = Math.max(0, cursorLine - half);
    const endLine = Math.min(allLines.length, startLine + maxVisibleLines);
    if (endLine - startLine < maxVisibleLines) {
      startLine = Math.max(0, endLine - maxVisibleLines);
    }

    return {
      lines: allLines.slice(startLine, startLine + maxVisibleLines),
      startLine,
      cursorLine,
    };
  }

  splitLineAtCursor(line: WrappedLine): {
    before: string;
    at: string;
    after: string;
  } {
    const cursorInLine = Math.max(0, this.cursor - line.start);
    let offset = 0;
    let before = "";
    const segments = graphemeSegments(line.text);

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!;
      const nextOffset = offset + segment.length;
      if (nextOffset <= cursorInLine) {
        before += segment;
        offset = nextOffset;
        continue;
      }
      return {
        before,
        at: segment,
        after: segments.slice(i + 1).join(""),
      };
    }

    return { before, at: " ", after: "" };
  }

  private previousWordStart(): number {
    let candidate = 0;
    for (const boundary of wordBoundaries(this.value)) {
      if (!boundary.isWordLike) continue;
      if (boundary.start < this.cursor && this.cursor <= boundary.end) {
        return boundary.start;
      }
      if (boundary.end <= this.cursor) {
        candidate = boundary.start;
      }
    }
    return candidate;
  }

  private withPosition(position: CursorPosition): PromptCursor {
    const line = this.getLine(position.line);
    const lineOffset = offsetAtDisplayColumn(line.text, position.column);
    return new PromptCursor(this.value, this.columns, line.start + lineOffset);
  }

  private getLine(line: number): WrappedLine {
    const lines = this.getWrappedLines();
    return lines[Math.max(0, Math.min(line, lines.length - 1))]!;
  }

  private getWrappedLines(): WrappedLine[] {
    this.wrappedLinesCache ??= wrapLinesWithOffsets(this.value, this.columns);
    return this.wrappedLinesCache;
  }
}
