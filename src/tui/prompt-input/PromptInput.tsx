import React from "react";
import { Box, Text, useInput } from "ink";
import type { Key } from "ink";
import type { PastePart } from "../types.js";
import { PromptCursor } from "./cursor.js";
import { normalizeTerminalInput } from "./editor.js";
import { applyTerminalInputChunk, hasInlineErase } from "./input-chunk.js";
import { normalizePaste, summarizePaste, nextPastePartId } from "./paste.js";
import { stringWidth } from "./width.js";
import { usePromptCursorDeclaration } from "../cursor-declaration.js";

export type PromptInputDebugEvent =
  | {
      type: "ink_input";
      input: string;
      key: Key;
      before: { value: string; cursor: number };
    }
  | {
      type: "commit";
      reason: string;
      after: { value: string; cursor: number };
    }
  | { type: "ignored"; reason: string }
  | { type: "submit"; value: string };

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
  onInputDebug?: (event: PromptInputDebugEvent) => void;
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
  onInputDebug,
}: PromptInputProps): React.ReactElement {
  const valueRef = React.useRef(value);
  const cursorRef = React.useRef(cursor);
  const pastePartsRef = React.useRef(pasteParts);
  const columnsRef = React.useRef(columns);
  const onChangeRef = React.useRef(onChange);
  const onSubmitRef = React.useRef(onSubmit);
  const onPastePartsChangeRef = React.useRef(onPastePartsChange);
  const onInputDebugRef = React.useRef(onInputDebug);

  React.useLayoutEffect(() => {
    valueRef.current = value;
    cursorRef.current = cursor;
    pastePartsRef.current = pasteParts;
    columnsRef.current = columns;
    onChangeRef.current = onChange;
    onSubmitRef.current = onSubmit;
    onPastePartsChangeRef.current = onPastePartsChange;
    onInputDebugRef.current = onInputDebug;
  });

  const handleInput = React.useCallback((input: string, key: Key) => {
    const currentValue = valueRef.current;
    const currentCursor = cursorRef.current;
    const currentPasteParts = pastePartsRef.current;
    onInputDebugRef.current?.({
      type: "ink_input",
      input,
      key,
      before: { value: currentValue, cursor: currentCursor },
    });
    const currentEditor = PromptCursor.from(
      currentValue,
      Math.max(columnsRef.current - 2, 10),
      currentCursor,
    );

    const commit = (editor: PromptCursor, reason: string) => {
      const state = editor.toState();
      valueRef.current = state.value;
      cursorRef.current = state.cursor;
      onChangeRef.current(state.value, state.cursor);
      onInputDebugRef.current?.({ type: "commit", reason, after: state });
    };

    if (
      key.backspace ||
      hasInlineErase(input) ||
      (key.ctrl && input === "h")
    ) {
      commit(
        hasInlineErase(input)
          ? applyTerminalInputChunk(currentEditor, input)
          : currentEditor.backspace(),
        "erase",
      );
      return;
    }

    if (key.delete) {
      commit(currentEditor.deleteForward(), "delete-forward");
      return;
    }

    if (key.ctrl) {
      if (input === "a") {
        commit(currentEditor.startOfLine(), "ctrl-a");
        return;
      }
      if (input === "b") {
        commit(currentEditor.left(), "ctrl-b");
        return;
      }
      if (input === "e") {
        commit(currentEditor.endOfLine(), "ctrl-e");
        return;
      }
      if (input === "f") {
        commit(currentEditor.right(), "ctrl-f");
        return;
      }
      if (input === "d") {
        commit(currentEditor.deleteForward(), "ctrl-d");
        return;
      }
      if (input === "u") {
        commit(currentEditor.deleteToLineStart(), "ctrl-u");
        return;
      }
      if (input === "k") {
        commit(currentEditor.deleteToLineEnd(), "ctrl-k");
        return;
      }
      if (input === "w") {
        commit(currentEditor.deleteWordBefore(), "ctrl-w");
        return;
      }
      onInputDebugRef.current?.({ type: "ignored", reason: "unhandled-ctrl" });
      return;
    }

    if (key.meta) {
      if (input === "b") {
        commit(currentEditor.previousWord(), "meta-b");
        return;
      }
      if (input === "f") {
        commit(currentEditor.nextWord(), "meta-f");
        return;
      }
      if (input === "d") {
        commit(currentEditor.deleteWordAfter(), "meta-d");
        return;
      }
    }

    if (key.leftArrow) {
      commit(currentEditor.left(), "left");
      return;
    }
    if (key.rightArrow) {
      commit(currentEditor.right(), "right");
      return;
    }
    if (key.upArrow) {
      commit(currentEditor.up(), "up");
      return;
    }
    if (key.downArrow) {
      commit(currentEditor.down(), "down");
      return;
    }
    if (key.return) {
      if (key.meta || key.shift) {
        commit(currentEditor.insert("\n"), "newline");
        return;
      }
      const endsWithBackslash =
        currentCursor > 0 && currentValue[currentCursor - 1] === "\\";
      if (endsWithBackslash) {
        const before = currentValue.slice(0, currentCursor - 1);
        const after = currentValue.slice(currentCursor);
        commit(
          PromptCursor.from(before + "\n" + after, columnsRef.current, currentCursor),
          "backslash-newline",
        );
        return;
      }
      if (currentValue.includes("\n")) {
        onInputDebugRef.current?.({ type: "submit", value: currentValue });
        onSubmitRef.current(currentValue);
        return;
      }
      onInputDebugRef.current?.({ type: "submit", value: currentValue });
      onSubmitRef.current(currentValue);
      return;
    }

    if (input && !key.ctrl) {
      if (hasInlineErase(input)) {
        commit(applyTerminalInputChunk(currentEditor, input), "inline-erase");
        return;
      }

      const terminalText = normalizeTerminalInput(input);
      if (!terminalText) {
        onInputDebugRef.current?.({ type: "ignored", reason: "empty-normalized" });
        return;
      }

      const normalized = normalizePaste(terminalText);
      const summary = summarizePaste(normalized, nextPastePartId(currentPasteParts));
      const inserted = summary ? `${summary.display} ` : normalized;
      commit(currentEditor.insert(inserted), summary ? "paste-summary" : "insert");
      if (summary) {
        onPastePartsChangeRef.current([...currentPasteParts, summary.part]);
      }
      return;
    }

    onInputDebugRef.current?.({ type: "ignored", reason: "unhandled-input" });
  }, []);

  useInput(handleInput, { isActive: focus && !disabled });

  const renderWidth = Math.max(columns - 2, 10);
  const editor = PromptCursor.from(value || "", renderWidth, cursor);
  const viewport = editor.getViewport(maxLines);
  const visibleLines = viewport.lines;
  const adjustedCursorLine = viewport.cursorLine - viewport.startLine;
  let cursorColumn = 0;

  if (visibleLines.length > 0 && adjustedCursorLine >= 0) {
    const line = visibleLines[Math.min(adjustedCursorLine, visibleLines.length - 1)]!;
    cursorColumn = stringWidth(editor.splitLineAtCursor(line).before);
  }

  usePromptCursorDeclaration(
    focus && !disabled
      ? {
          linesBelowCursor: Math.max(0, visibleLines.length - adjustedCursorLine + 1),
          cursorColumn,
        }
      : null,
  );

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
      const { before, at, after } = editor.splitLineAtCursor(line);
      elements.push(
        <Text key={`l${i}`}>
          {before}
          <Text inverse>{at}</Text>
          {after}
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
