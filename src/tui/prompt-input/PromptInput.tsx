import React from "react";
import { Box, Text, useInput } from "ink";
import type { Key } from "ink";
import type { PastePart } from "../types.js";
import type { EditorState } from "./editor.js";
import {
  insertText,
  backspace,
  deleteForward,
  moveLeft,
  moveRight,
  moveHome,
  moveEnd,
  deleteToHome,
  deleteToEnd,
  deleteWordBack,
  insertNewline,
  graphemeSegments,
  normalizeTerminalInput,
} from "./editor.js";
import { wrapLinesWithOffsets } from "./width.js";
import { normalizePaste, summarizePaste, nextPastePartId } from "./paste.js";

type PromptInputProps = {
  value: string;
  cursor: number;
  onChange: (value: string, cursor: number) => void;
  onSubmit: (value: string) => void;
  pasteParts: PastePart[];
  onPastePartsChange: (parts: PastePart[]) => void;
  focus: boolean;
  columns: number;
  maxLines?: number;
  placeholder?: string;
  disabled?: boolean;
};

const MAX_VISIBLE_LINES = 6;

export function PromptInput({
  value,
  cursor,
  onChange,
  onSubmit,
  pasteParts,
  onPastePartsChange,
  focus,
  columns,
  maxLines = MAX_VISIBLE_LINES,
  placeholder,
  disabled,
}: PromptInputProps): React.ReactElement {
  const valueRef = React.useRef(value);
  const cursorRef = React.useRef(cursor);
  const pastePartsRef = React.useRef(pasteParts);
  const onChangeRef = React.useRef(onChange);
  const onSubmitRef = React.useRef(onSubmit);
  const onPastePartsChangeRef = React.useRef(onPastePartsChange);

  React.useLayoutEffect(() => {
    valueRef.current = value;
    cursorRef.current = cursor;
    pastePartsRef.current = pasteParts;
    onChangeRef.current = onChange;
    onSubmitRef.current = onSubmit;
    onPastePartsChangeRef.current = onPastePartsChange;
  });

  const handleInput = React.useCallback((input: string, key: Key) => {
    const currentValue = valueRef.current;
    const currentCursor = cursorRef.current;
    const currentPasteParts = pastePartsRef.current;

    if (
      key.backspace ||
      key.delete ||
      input.includes("\x7f") ||
      input.includes("\b") ||
      (key.ctrl && input === "h")
    ) {
      const deleteCount =
        [...input].filter((ch) => ch === "\x7f" || ch === "\b").length || 1;
      let state: EditorState = { value: currentValue, cursor: currentCursor };
      for (let i = 0; i < deleteCount; i++) {
        state = backspace(state);
      }
      onChangeRef.current(state.value, state.cursor);
      return;
    }

    if (key.ctrl) {
      if (input === "a") {
        const s = moveHome({ value: currentValue, cursor: currentCursor });
        onChangeRef.current(s.value, s.cursor);
        return;
      }
      if (input === "e") {
        const s = moveEnd({ value: currentValue, cursor: currentCursor });
        onChangeRef.current(s.value, s.cursor);
        return;
      }
      if (input === "d") {
        const s = deleteForward({ value: currentValue, cursor: currentCursor });
        onChangeRef.current(s.value, s.cursor);
        return;
      }
      if (input === "u") {
        const s = deleteToHome({ value: currentValue, cursor: currentCursor });
        onChangeRef.current(s.value, s.cursor);
        return;
      }
      if (input === "k") {
        const s = deleteToEnd({ value: currentValue, cursor: currentCursor });
        onChangeRef.current(s.value, s.cursor);
        return;
      }
      if (input === "w") {
        const s = deleteWordBack({ value: currentValue, cursor: currentCursor });
        onChangeRef.current(s.value, s.cursor);
        return;
      }
      return;
    }

    if (key.leftArrow) {
      const s = moveLeft({ value: currentValue, cursor: currentCursor });
      onChangeRef.current(s.value, s.cursor);
      return;
    }
    if (key.rightArrow) {
      const s = moveRight({ value: currentValue, cursor: currentCursor });
      onChangeRef.current(s.value, s.cursor);
      return;
    }
    if (key.return) {
      if (key.meta || key.shift) {
        const s = insertNewline({ value: currentValue, cursor: currentCursor });
        onChangeRef.current(s.value, s.cursor);
        return;
      }
      const endsWithBackslash =
        currentCursor > 0 && currentValue[currentCursor - 1] === "\\";
      if (endsWithBackslash) {
        const before = currentValue.slice(0, currentCursor - 1);
        const after = currentValue.slice(currentCursor);
        const newState: EditorState = {
          value: before + "\n" + after,
          cursor: currentCursor,
        };
        onChangeRef.current(newState.value, newState.cursor);
        return;
      }
      if (currentValue.includes("\n")) {
        onSubmitRef.current(currentValue);
        return;
      }
      onSubmitRef.current(currentValue);
      return;
    }

    if (input && !key.ctrl) {
      const terminalText = normalizeTerminalInput(input);
      if (!terminalText) return;

      const normalized = normalizePaste(terminalText);
      const summary = summarizePaste(normalized, nextPastePartId(currentPasteParts));
      const inserted = summary ? `${summary.display} ` : normalized;
      const s = insertText({ value: currentValue, cursor: currentCursor }, inserted);
      onChangeRef.current(s.value, s.cursor);
      if (summary) {
        onPastePartsChangeRef.current([...currentPasteParts, summary.part]);
      }
    }
  }, []);

  useInput(handleInput, { isActive: focus && !disabled });

  const renderWidth = Math.max(columns - 2, 10);
  const lines = wrapLinesWithOffsets(value || "", renderWidth);
  const visibleLines = lines.slice(-maxLines);
  const scrollOffset = Math.max(0, lines.length - maxLines);
  const cursorLineIndex = findCursorLineIndex(lines, cursor);
  const adjustedCursorLine = cursorLineIndex - scrollOffset;

  if (!focus || disabled) {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="gray">{placeholder ?? "> "}</Text>
          <Text>{value}</Text>
        </Box>
      </Box>
    );
  }

  const elements: React.ReactElement[] = [];
  for (let i = 0; i < visibleLines.length; i++) {
    const line = visibleLines[i]!;
    if (i === adjustedCursorLine) {
      const { beforePart, cursorChar, afterPart } = splitLineAtCursor(
        line.text,
        Math.max(0, cursor - line.start),
      );
      elements.push(
        <Text key={`l${i}`}>
          {beforePart}
          <Text inverse>{cursorChar}</Text>
          {afterPart}
        </Text>,
      );
    } else {
      elements.push(<Text key={`l${i}`}>{line.text || " "}</Text>);
    }
  }

  return (
    <Box flexDirection="column">
      {value.length === 0 && placeholder ? (
        <Box>
          <Text inverse> </Text>
          <Text color="gray">{placeholder}</Text>
        </Box>
      ) : (
        elements
      )}
    </Box>
  );
}

function findCursorLineIndex(
  lines: Array<{ start: number; end: number }>,
  cursor: number,
): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (cursor >= line.start && cursor <= line.end) return i;
  }
  return Math.max(0, lines.length - 1);
}

function splitLineAtCursor(
  line: string,
  cursor: number,
): { beforePart: string; cursorChar: string; afterPart: string } {
  let offset = 0;
  let beforePart = "";
  const segments = graphemeSegments(line);

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    const nextOffset = offset + segment.length;
    if (nextOffset <= cursor) {
      beforePart += segment;
      offset = nextOffset;
      continue;
    }
    return {
      beforePart,
      cursorChar: segment,
      afterPart: segments.slice(i + 1).join(""),
    };
  }

  return {
    beforePart,
    cursorChar: " ",
    afterPart: "",
  };
}
