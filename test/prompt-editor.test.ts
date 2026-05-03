import { describe, expect, it } from "vitest";
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
} from "../src/tui/prompt-input/editor.js";
import { PromptCursor } from "../src/tui/prompt-input/cursor.js";
import { applyTerminalInputChunk } from "../src/tui/prompt-input/input-chunk.js";
import { normalizePromptInput } from "../src/tui/prompt-input/usePromptInput.js";
import { wrapLinesWithOffsets } from "../src/tui/prompt-input/width.js";

type S = { value: string; cursor: number };
const s = (value: string, cursor: number): S => ({ value, cursor });

// "a👍b": a=index 0, 👍(surrogate pair)=indices 1-2, b=index 3
// "a🇺🇸b": a=0, 🇺🇸(4 code units)=1-4, b=5
const EMOJI = "\u{1F44D}";
const FLAG = "\u{1F1FA}\u{1F1F8}";

describe("graphemeSegments", () => {
  it("splits ascii into individual chars", () => {
    expect(graphemeSegments("abc")).toEqual(["a", "b", "c"]);
  });

  it("keeps emoji as single segments", () => {
    expect(graphemeSegments(`a${EMOJI}b`)).toEqual(["a", EMOJI, "b"]);
  });

  it("keeps CJK characters as single segments", () => {
    expect(graphemeSegments("你好")).toEqual(["你", "好"]);
  });

  it("handles regional indicator pairs (flags)", () => {
    expect(graphemeSegments(FLAG)).toEqual([FLAG]);
  });

  it("handles combining characters", () => {
    const decomposed = "é";
    expect(graphemeSegments(decomposed)).toEqual([decomposed]);
  });
});

describe("insertText", () => {
  it("inserts ascii at cursor", () => {
    expect(insertText(s("ac", 1), "b")).toEqual(s("abc", 2));
  });

  it("inserts at beginning", () => {
    expect(insertText(s("bc", 0), "a")).toEqual(s("abc", 1));
  });

  it("inserts at end", () => {
    expect(insertText(s("ab", 2), "c")).toEqual(s("abc", 3));
  });

  it("inserts Chinese text", () => {
    expect(insertText(s("", 0), "你好")).toEqual(s("你好", 2));
  });

  it("inserts multi-char string", () => {
    expect(insertText(s("ad", 1), "bc")).toEqual(s("abcd", 3));
  });
});

describe("backspace", () => {
  it("deletes character before cursor", () => {
    expect(backspace(s("abc", 2))).toEqual(s("ac", 1));
  });

  it("does nothing at start", () => {
    expect(backspace(s("abc", 0))).toEqual(s("abc", 0));
  });

  it("deletes emoji as whole grapheme", () => {
    // cursor at 3 = after 👍, backspace should delete the whole emoji
    const input = `a${EMOJI}b`;
    expect(backspace(s(input, 3))).toEqual(s("ab", 1));
  });

  it("deletes CJK character as single unit", () => {
    expect(backspace(s("你好", 1))).toEqual(s("好", 0));
  });

  it("deletes flag emoji as whole grapheme", () => {
    // cursor at 5 = after 🇺🇸, backspace should delete the whole flag
    const input = `a${FLAG}b`;
    expect(backspace(s(input, 5))).toEqual(s("ab", 1));
  });

  it("deletes combining character sequence", () => {
    // é as decomposed e + combining acute (2 code units)
    // cursor at 3 = after the full combining sequence
    const decomposed = "a" + "é" + "b";
    expect(backspace(s(decomposed, 3))).toEqual(s("ab", 1));
  });
});

describe("deleteForward", () => {
  it("deletes character after cursor", () => {
    expect(deleteForward(s("abc", 1))).toEqual(s("ac", 1));
  });

  it("does nothing at end", () => {
    expect(deleteForward(s("abc", 3))).toEqual(s("abc", 3));
  });

  it("deletes emoji as whole grapheme", () => {
    // cursor at 1 = before 👍, deleteForward should delete the whole emoji
    const input = `a${EMOJI}b`;
    expect(deleteForward(s(input, 1))).toEqual(s("ab", 1));
  });
});

describe("moveLeft", () => {
  it("moves cursor left by one char", () => {
    expect(moveLeft(s("abc", 2))).toEqual(s("abc", 1));
  });

  it("does nothing at start", () => {
    expect(moveLeft(s("abc", 0))).toEqual(s("abc", 0));
  });

  it("moves past emoji as one unit", () => {
    // cursor at 3 = after 👍, moveLeft should go to 1 (before 👍)
    const input = `a${EMOJI}b`;
    expect(moveLeft(s(input, 3))).toEqual(s(input, 1));
  });
});

describe("moveRight", () => {
  it("moves cursor right by one char", () => {
    expect(moveRight(s("abc", 1))).toEqual(s("abc", 2));
  });

  it("does nothing at end", () => {
    expect(moveRight(s("abc", 3))).toEqual(s("abc", 3));
  });

  it("moves past emoji as one unit", () => {
    // cursor at 1 = before 👍, moveRight should go to 3 (after 👍)
    const input = `a${EMOJI}b`;
    expect(moveRight(s(input, 1))).toEqual(s(input, 3));
  });
});

describe("moveHome", () => {
  it("moves to start of line", () => {
    expect(moveHome(s("abc", 2))).toEqual(s("abc", 0));
  });

  it("moves to start of current line in multiline", () => {
    expect(moveHome(s("abc\ndef", 6))).toEqual(s("abc\ndef", 4));
  });

  it("stays at line start", () => {
    expect(moveHome(s("abc", 0))).toEqual(s("abc", 0));
  });
});

describe("moveEnd", () => {
  it("moves to end of line", () => {
    expect(moveEnd(s("abc", 1))).toEqual(s("abc", 3));
  });

  it("moves to end of current line in multiline", () => {
    expect(moveEnd(s("abc\ndef", 4))).toEqual(s("abc\ndef", 7));
  });

  it("stays at end", () => {
    expect(moveEnd(s("abc", 3))).toEqual(s("abc", 3));
  });
});

describe("deleteToHome", () => {
  it("deletes from cursor to start of line", () => {
    expect(deleteToHome(s("abc", 2))).toEqual(s("c", 0));
  });

  it("deletes from cursor to newline in multiline", () => {
    expect(deleteToHome(s("abc\ndef", 6))).toEqual(s("abc\nf", 4));
  });

  it("does nothing at start", () => {
    expect(deleteToHome(s("abc", 0))).toEqual(s("abc", 0));
  });
});

describe("deleteToEnd", () => {
  it("deletes from cursor to end of line", () => {
    expect(deleteToEnd(s("abc", 1))).toEqual(s("a", 1));
  });

  it("deletes from cursor to newline in multiline", () => {
    expect(deleteToEnd(s("abc\ndef", 4))).toEqual(s("abc\n", 4));
  });

  it("does nothing at end", () => {
    expect(deleteToEnd(s("abc", 3))).toEqual(s("abc", 3));
  });
});

describe("deleteWordBack", () => {
  it("deletes previous word", () => {
    expect(deleteWordBack(s("hello world", 11))).toEqual(s("hello ", 6));
  });

  it("deletes trailing spaces then word (standard Ctrl+W)", () => {
    // Standard unix-word-rubout: eat spaces then the word
    expect(deleteWordBack(s("hello  ", 7))).toEqual(s("", 0));
  });

  it("deletes from middle of word", () => {
    expect(deleteWordBack(s("hello", 3))).toEqual(s("lo", 0));
  });

  it("does nothing at start", () => {
    expect(deleteWordBack(s("hello", 0))).toEqual(s("hello", 0));
  });

  it("stops at newline", () => {
    expect(deleteWordBack(s("abc\ndef", 7))).toEqual(s("abc\n", 4));
  });
});

describe("insertNewline", () => {
  it("inserts newline at cursor", () => {
    expect(insertNewline(s("abc", 1))).toEqual(s("a\nbc", 2));
  });

  it("inserts newline at end", () => {
    expect(insertNewline(s("abc", 3))).toEqual(s("abc\n", 4));
  });

  it("inserts newline creates multiline", () => {
    expect(insertNewline(s("ab", 1))).toEqual(s("a\nb", 2));
  });
});

describe("normalizeTerminalInput", () => {
  it("strips ANSI escape sequences before inserting text", () => {
    expect(normalizeTerminalInput("\x1b[31mred\x1b[0m")).toBe("red");
  });

  it("drops a coalesced trailing carriage return after text", () => {
    expect(normalizeTerminalInput("hello\r")).toBe("hello");
  });

  it("keeps backslash carriage return as a newline", () => {
    expect(normalizeTerminalInput("hello\\\r")).toBe("hello\\\n");
  });

  it("converts embedded carriage returns to newlines", () => {
    expect(normalizeTerminalInput("a\rb")).toBe("a\nb");
  });
});

describe("wrapLinesWithOffsets", () => {
  it("preserves CJK offsets when wrapping by display width", () => {
    expect(wrapLinesWithOffsets("你好a", 4)).toEqual([
      { text: "你好", start: 0, end: 2 },
      { text: "a", start: 2, end: 3 },
    ]);
  });

  it("preserves emoji offsets when wrapping", () => {
    const input = `a${EMOJI}b`;
    expect(wrapLinesWithOffsets(input, 2)).toEqual([
      { text: "a", start: 0, end: 1 },
      { text: EMOJI, start: 1, end: 3 },
      { text: "b", start: 3, end: 4 },
    ]);
  });

  it("does not split multi-codepoint graphemes while wrapping", () => {
    const input = `a${FLAG}b`;
    expect(wrapLinesWithOffsets(input, 2)).toEqual([
      { text: "a", start: 0, end: 1 },
      { text: FLAG, start: 1, end: 5 },
      { text: "b", start: 5, end: 6 },
    ]);
  });

  it("tracks offsets across explicit newlines", () => {
    expect(wrapLinesWithOffsets("ab\ncd", 10)).toEqual([
      { text: "ab", start: 0, end: 2 },
      { text: "cd", start: 3, end: 5 },
    ]);
  });
});

describe("PromptCursor", () => {
  it("maps cursor offsets through NFC normalization", () => {
    const decomposed = "a" + "é" + "b";
    const cursor = PromptCursor.from(decomposed, 80, 3);
    expect(cursor.backspace().toState()).toEqual(s("ab", 1));
  });

  it("moves up and down by wrapped visual lines", () => {
    const cursor = PromptCursor.from("abcdef", 3, 5);
    expect(cursor.up().toState()).toEqual(s("abcdef", 2));
    expect(cursor.up().down().toState()).toEqual(s("abcdef", 5));
  });

  it("splits CJK cursor position by grapheme offset", () => {
    const cursor = PromptCursor.from("你好", 80, 1);
    expect(cursor.splitLineAtCursor({ text: "你好", start: 0, end: 2 })).toEqual({
      before: "你",
      at: "好",
      after: "",
    });
  });

  it("splits emoji cursor position without cutting surrogate pairs", () => {
    const input = `a${EMOJI}b`;
    const cursor = PromptCursor.from(input, 80, 1);
    expect(cursor.splitLineAtCursor({ text: input, start: 0, end: 4 })).toEqual({
      before: "a",
      at: EMOJI,
      after: "b",
    });
  });
});

describe("applyTerminalInputChunk", () => {
  it("applies coalesced erase and insert bytes in order", () => {
    const cursor = PromptCursor.from("abc你好def", 80, 8);
    expect(applyTerminalInputChunk(cursor, "\x7f\x7fX").toState()).toEqual(
      s("abc你好dX", 7),
    );
  });

  it("handles text before and after an inline erase", () => {
    const cursor = PromptCursor.from("", 80, 0);
    expect(applyTerminalInputChunk(cursor, "ab\x7fc").toState()).toEqual(s("ac", 2));
  });

  it("does not split CJK characters around inline erase", () => {
    const cursor = PromptCursor.from("", 80, 0);
    expect(applyTerminalInputChunk(cursor, "你好\x7f啊").toState()).toEqual(s("你啊", 2));
  });
});

describe("normalizePromptInput", () => {
  const key = (overrides: Record<string, unknown> = {}) => overrides as any;

  it("treats raw DEL as backspace before Ink key metadata", () => {
    expect(normalizePromptInput("", key({ delete: true }), "\x7f")).toEqual({
      type: "backspace",
    });
  });

  it("treats Delete escape sequence as forward delete", () => {
    expect(normalizePromptInput("", key({ delete: true }), "\x1b[3~")).toEqual({
      type: "delete-forward",
    });
  });

  it("does not guess delete direction when raw input is unavailable", () => {
    expect(normalizePromptInput("", key({ delete: true }))).toEqual({
      type: "noop",
      reason: "ambiguous-delete-without-raw-input",
    });
  });

  it("keeps mixed text and erase as an ordered input chunk", () => {
    expect(normalizePromptInput("ab\x7fc", key(), "ab\x7fc")).toEqual({
      type: "apply-chunk",
      input: "ab\x7fc",
    });
  });

  it("does not replay a multi-byte raw chunk for a normal text key event", () => {
    expect(normalizePromptInput("a", key(), "abc")).toEqual({
      type: "insert",
      text: "a",
    });
  });

  it("treats Ghostty IME trailing delete sequence as forward-delete, not backspace", () => {
    expect(normalizePromptInput("", key({ delete: true }), "\x1b[3~")).toEqual({
      type: "delete-forward",
    });
  });

  it("maps return to submit and shifted return to newline", () => {
    expect(normalizePromptInput("", key({ return: true }))).toEqual({
      type: "submit",
    });
    expect(normalizePromptInput("", key({ return: true, shift: true }))).toEqual({
      type: "newline",
    });
  });

  it("ignores SGR mouse sequences so they do not enter prompt text", () => {
    expect(normalizePromptInput("\x1b[<64;10;5M", key())).toEqual({
      type: "noop",
      reason: "mouse",
    });
    expect(normalizePromptInput("[<64;10;5M", key())).toEqual({
      type: "noop",
      reason: "mouse",
    });
  });
});

describe("PromptCursor deleteForward", () => {
  it("does not delete the character before the cursor at the end of input", () => {
    const cursor = PromptCursor.from(" 中文 d", 80, 5);
    expect(cursor.deleteForward().toState()).toEqual(s(" 中文 d", 5));
  });
});
