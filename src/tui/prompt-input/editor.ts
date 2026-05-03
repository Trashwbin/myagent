import { PromptCursor } from "./cursor.js";
import { graphemeSegments, normalizeTerminalInput } from "./unicode.js";

export { graphemeSegments, normalizeTerminalInput } from "./unicode.js";

export type EditorState = {
  value: string;
  cursor: number;
};

const DEFAULT_COLUMNS = 80;

function cursorFromState(state: EditorState): PromptCursor {
  return PromptCursor.from(state.value, DEFAULT_COLUMNS, state.cursor);
}

export function insertText(state: EditorState, text: string): EditorState {
  return cursorFromState(state).insert(text).toState();
}

export function backspace(state: EditorState): EditorState {
  return cursorFromState(state).backspace().toState();
}

export function deleteForward(state: EditorState): EditorState {
  return cursorFromState(state).deleteForward().toState();
}

export function moveLeft(state: EditorState): EditorState {
  return cursorFromState(state).left().toState();
}

export function moveRight(state: EditorState): EditorState {
  return cursorFromState(state).right().toState();
}

export function moveHome(state: EditorState): EditorState {
  return cursorFromState(state).startOfLine().toState();
}

export function moveEnd(state: EditorState): EditorState {
  return cursorFromState(state).endOfLine().toState();
}

export function deleteToHome(state: EditorState): EditorState {
  return cursorFromState(state).deleteToLineStart().toState();
}

export function deleteToEnd(state: EditorState): EditorState {
  return cursorFromState(state).deleteToLineEnd().toState();
}

export function deleteWordBack(state: EditorState): EditorState {
  return cursorFromState(state).deleteWordBefore().toState();
}

export function insertNewline(state: EditorState): EditorState {
  return insertText(state, "\n");
}
