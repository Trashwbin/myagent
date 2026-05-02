export type EditorState = {
  value: string;
  cursor: number;
};

const GRAPHEME_BREAK_REGEX =
  /\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic})*|\P{M}\p{M}*|\p{M}+/gu;
const ANSI_ESCAPE_REGEX = /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export function graphemeSegments(text: string): string[] {
  if (!text) return [];
  return text.match(GRAPHEME_BREAK_REGEX) ?? [...text];
}

export function insertText(state: EditorState, text: string): EditorState {
  return {
    value: state.value.slice(0, state.cursor) + text + state.value.slice(state.cursor),
    cursor: state.cursor + text.length,
  };
}

export function normalizeTerminalInput(input: string): string {
  return input
    .replace(ANSI_ESCAPE_REGEX, "")
    .replace(/(?<=[^\\\r\n])\r$/u, "")
    .replace(/\r/g, "\n");
}

export function backspace(state: EditorState): EditorState {
  if (state.cursor === 0) return state;
  const before = state.value.slice(0, state.cursor);
  const segments = graphemeSegments(before);
  const deleteCount = segments.length > 0 ? segments[segments.length - 1]!.length : 1;
  return {
    value:
      state.value.slice(0, state.cursor - deleteCount) + state.value.slice(state.cursor),
    cursor: state.cursor - deleteCount,
  };
}

export function deleteForward(state: EditorState): EditorState {
  if (state.cursor >= state.value.length) return state;
  const after = state.value.slice(state.cursor);
  const segments = graphemeSegments(after);
  const deleteCount = segments.length > 0 ? segments[0]!.length : 1;
  return {
    value:
      state.value.slice(0, state.cursor) + state.value.slice(state.cursor + deleteCount),
    cursor: state.cursor,
  };
}

export function moveLeft(state: EditorState): EditorState {
  if (state.cursor === 0) return state;
  const before = state.value.slice(0, state.cursor);
  const segments = graphemeSegments(before);
  const step = segments.length > 0 ? segments[segments.length - 1]!.length : 1;
  return { ...state, cursor: state.cursor - step };
}

export function moveRight(state: EditorState): EditorState {
  if (state.cursor >= state.value.length) return state;
  const after = state.value.slice(state.cursor);
  const segments = graphemeSegments(after);
  const step = segments.length > 0 ? segments[0]!.length : 1;
  return { ...state, cursor: state.cursor + step };
}

export function moveHome(state: EditorState): EditorState {
  const lineStart = state.value.lastIndexOf("\n", state.cursor - 1) + 1;
  return { ...state, cursor: lineStart };
}

export function moveEnd(state: EditorState): EditorState {
  const nextNewline = state.value.indexOf("\n", state.cursor);
  return { ...state, cursor: nextNewline === -1 ? state.value.length : nextNewline };
}

export function deleteToHome(state: EditorState): EditorState {
  const lineStart = state.value.lastIndexOf("\n", state.cursor - 1) + 1;
  return {
    value: state.value.slice(0, lineStart) + state.value.slice(state.cursor),
    cursor: lineStart,
  };
}

export function deleteToEnd(state: EditorState): EditorState {
  const nextNewline = state.value.indexOf("\n", state.cursor);
  const end = nextNewline === -1 ? state.value.length : nextNewline;
  return {
    value: state.value.slice(0, state.cursor) + state.value.slice(end),
    cursor: state.cursor,
  };
}

export function deleteWordBack(state: EditorState): EditorState {
  if (state.cursor === 0) return state;
  let pos = state.cursor;
  while (pos > 0 && state.value[pos - 1] === " ") pos--;
  while (pos > 0 && state.value[pos - 1] !== " " && state.value[pos - 1] !== "\n") pos--;
  return {
    value: state.value.slice(0, pos) + state.value.slice(state.cursor),
    cursor: pos,
  };
}

export function insertNewline(state: EditorState): EditorState {
  return insertText(state, "\n");
}
