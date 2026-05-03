import React from "react";
import type { Key } from "ink";
import type { PastePart } from "../types.js";
import { PromptCursor } from "./cursor.js";
import { normalizeTerminalInput } from "./editor.js";
import { applyTerminalInputChunk } from "./input-chunk.js";
import { normalizePaste, nextPastePartId, summarizePaste } from "./paste.js";
import { RawInputContext } from "./raw-input.js";
import { containsMouseSequence } from "../mouse-input.js";

export type PromptInputDebugEvent =
  | {
      type: "ink_input";
      input: string;
      rawInput: string;
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

export type PromptInputState = {
  editor: PromptCursor;
  visibleLines: ReturnType<PromptCursor["getViewport"]>["lines"];
  adjustedCursorLine: number;
  onInput: (input: string, key: Key) => void;
};

type PromptInputAction =
  | { type: "backspace" }
  | { type: "delete-forward" }
  | { type: "left" }
  | { type: "right" }
  | { type: "up" }
  | { type: "down" }
  | { type: "home" }
  | { type: "end" }
  | { type: "submit" }
  | { type: "newline" }
  | { type: "ctrl"; input: string }
  | { type: "meta"; input: string }
  | { type: "insert"; text: string }
  | { type: "apply-chunk"; input: string }
  | { type: "noop"; reason: string };

type UsePromptInputOptions = {
  value: string;
  cursor: number;
  onChange: (value: string, cursor: number) => void;
  onSubmit: (value: string) => void;
  pasteParts: PastePart[];
  onPastePartsChange: (parts: PastePart[]) => void;
  columns: number;
  maxLines: number;
  onInputDebug?: (event: PromptInputDebugEvent) => void;
};

type InputHandler = (input: string) => PromptCursor | void;

const NOOP_HANDLER: InputHandler = () => undefined;

function mapInput(inputMap: Array<[string, InputHandler]>): InputHandler {
  const handlers = new Map(inputMap);
  return (input: string) => (handlers.get(input) ?? NOOP_HANDLER)(input);
}

export function usePromptInput({
  value,
  cursor,
  onChange,
  onSubmit,
  pasteParts,
  onPastePartsChange,
  columns,
  maxLines,
  onInputDebug,
}: UsePromptInputOptions): PromptInputState {
  const rawInput = React.useContext(RawInputContext);
  const valueRef = React.useRef(value);
  const cursorRef = React.useRef(cursor);
  const pastePartsRef = React.useRef(pasteParts);
  const onChangeRef = React.useRef(onChange);
  const onSubmitRef = React.useRef(onSubmit);
  const onPastePartsChangeRef = React.useRef(onPastePartsChange);
  const onInputDebugRef = React.useRef(onInputDebug);

  React.useLayoutEffect(() => {
    valueRef.current = value;
    cursorRef.current = cursor;
    pastePartsRef.current = pasteParts;
    onChangeRef.current = onChange;
    onSubmitRef.current = onSubmit;
    onPastePartsChangeRef.current = onPastePartsChange;
    onInputDebugRef.current = onInputDebug;
  });

  const renderWidth = Math.max(columns - 2, 10);
  const editor = PromptCursor.from(value || "", renderWidth, cursor);
  const viewport = editor.getViewport(maxLines);

  const onInput = React.useCallback(
    (input: string, key: Key) => {
      const currentValue = valueRef.current;
      const currentCursor = cursorRef.current;
      const currentPasteParts = pastePartsRef.current;
      const currentEditor = PromptCursor.from(
        currentValue,
        Math.max(columns - 2, 10),
        currentCursor,
      );

      onInputDebugRef.current?.({
        type: "ink_input",
        input,
        rawInput: rawInput.lastChunk(),
        key,
        before: { value: currentValue, cursor: currentCursor },
      });

      const commit = (next: PromptCursor, reason: string) => {
        const state = next.toState();
        valueRef.current = state.value;
        cursorRef.current = state.cursor;
        onChangeRef.current(state.value, state.cursor);
        onInputDebugRef.current?.({ type: "commit", reason, after: state });
      };

      const submit = () => {
        onInputDebugRef.current?.({ type: "submit", value: currentValue });
        onSubmitRef.current(currentValue);
      };

      const handleCtrl = mapInput([
        ["a", () => currentEditor.startOfLine()],
        ["b", () => currentEditor.left()],
        ["d", () => currentEditor.deleteForward()],
        ["e", () => currentEditor.endOfLine()],
        ["f", () => currentEditor.right()],
        ["h", () => currentEditor.backspace()],
        ["k", () => currentEditor.deleteToLineEnd()],
        ["u", () => currentEditor.deleteToLineStart()],
        ["w", () => currentEditor.deleteWordBefore()],
      ]);

      const handleMeta = mapInput([
        ["b", () => currentEditor.previousWord()],
        ["f", () => currentEditor.nextWord()],
        ["d", () => currentEditor.deleteWordAfter()],
      ]);

      const action = normalizePromptInput(input, key, rawInput.lastChunk());
      switch (action.type) {
        case "backspace":
          commit(currentEditor.backspace(), "backspace");
          return;
        case "delete-forward":
          commit(currentEditor.deleteForward(), "delete-forward");
          return;
        case "left":
          commit(currentEditor.left(), "left");
          return;
        case "right":
          commit(currentEditor.right(), "right");
          return;
        case "up":
          commit(currentEditor.up(), "up");
          return;
        case "down":
          commit(currentEditor.down(), "down");
          return;
        case "home":
          commit(currentEditor.startOfLine(), "home");
          return;
        case "end":
          commit(currentEditor.endOfLine(), "end");
          return;
        case "submit":
          if (
            currentEditor.cursor > 0 &&
            currentEditor.value[currentEditor.cursor - 1] === "\\"
          ) {
            const before = currentEditor.value.slice(0, currentEditor.cursor - 1);
            const after = currentEditor.value.slice(currentEditor.cursor);
            commit(
              PromptCursor.from(
                before + "\n" + after,
                Math.max(columns - 2, 10),
                currentEditor.cursor,
              ),
              "backslash-newline",
            );
            return;
          }
          submit();
          return;
        case "newline":
          commit(currentEditor.insert("\n"), "newline");
          return;
        case "ctrl": {
          const next = handleCtrl(action.input);
          if (next) commit(next, `ctrl-${action.input}`);
          return;
        }
        case "meta": {
          const next = handleMeta(action.input);
          if (next) commit(next, `meta-${action.input}`);
          return;
        }
        case "insert": {
          const normalized = normalizePaste(action.text);
          const summary = summarizePaste(normalized, nextPastePartId(currentPasteParts));
          const inserted = summary ? `${summary.display} ` : normalized;
          commit(currentEditor.insert(inserted), summary ? "paste-summary" : "insert");
          if (summary) {
            onPastePartsChangeRef.current([...currentPasteParts, summary.part]);
          }
          return;
        }
        case "apply-chunk":
          commit(applyTerminalInputChunk(currentEditor, action.input), "inline-erase");
          return;
        case "noop":
          onInputDebugRef.current?.({ type: "ignored", reason: action.reason });
          return;
      }
    },
    [columns, rawInput],
  );

  return {
    editor,
    visibleLines: viewport.lines,
    adjustedCursorLine: viewport.cursorLine - viewport.startLine,
    onInput,
  };
}

export function normalizePromptInput(
  input: string,
  key: Key,
  rawInput = input,
): PromptInputAction {
  if (containsMouseSequence(input) || containsMouseSequence(rawInput)) {
    return { type: "noop", reason: "mouse" };
  }
  if (input === "\x7f" || input === "\b") return { type: "backspace" };
  if (input === "\x1b[3~") return { type: "delete-forward" };
  if (input === "\x1b[H" || input === "\x1b[1~") return { type: "home" };
  if (input === "\x1b[F" || input === "\x1b[4~") return { type: "end" };
  if (input.includes("\x7f") || input.includes("\b")) {
    return { type: "apply-chunk", input };
  }

  switch (true) {
    case key.leftArrow && (key.ctrl || key.meta):
      return { type: "meta", input: "b" };
    case key.rightArrow && (key.ctrl || key.meta):
      return { type: "meta", input: "f" };
    case key.backspace:
      return { type: "backspace" };
    case key.delete: {
      if (input === "") {
        if (rawInput === "\x7f" || rawInput === "\b") return { type: "backspace" };
        if (rawInput === "\x1b[3~") return { type: "delete-forward" };
      }
      return { type: "noop", reason: "ambiguous-delete-without-raw-input" };
    }
    case key.ctrl:
      return { type: "ctrl", input };
    case key.meta:
      return { type: "meta", input };
    case key.leftArrow:
      return { type: "left" };
    case key.rightArrow:
      return { type: "right" };
    case key.upArrow:
      return { type: "up" };
    case key.downArrow:
      return { type: "down" };
    case key.return:
      return key.meta || key.shift ? { type: "newline" } : { type: "submit" };
    case key.tab:
    case key.escape:
      return { type: "noop", reason: key.tab ? "tab" : "escape" };
    default:
      break;
  }

  const text = normalizeTerminalInput(input);
  if (!text) return { type: "noop", reason: "empty-normalized" };
  return { type: "insert", text };
}
