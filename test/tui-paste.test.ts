import { describe, expect, it } from "vitest";
import { normalizePaste, summarizePaste, expandPromptText } from "../src/tui/prompt-input/paste.js";

describe("normalizePaste", () => {
  it("normalizes CRLF to LF", () => {
    expect(normalizePaste("hello\r\nworld")).toBe("hello\nworld");
  });

  it("normalizes CR to LF", () => {
    expect(normalizePaste("hello\rworld")).toBe("hello\nworld");
  });

  it("leaves LF-only text unchanged", () => {
    expect(normalizePaste("hello\nworld")).toBe("hello\nworld");
  });

  it("leaves text without newlines unchanged", () => {
    expect(normalizePaste("hello world")).toBe("hello world");
  });

  it("handles mixed line endings", () => {
    expect(normalizePaste("a\r\nb\rc\n")).toBe("a\nb\nc\n");
  });
});

describe("summarizePaste", () => {
  it("returns null for short single-line text", () => {
    expect(summarizePaste("hello")).toBeNull();
  });

  it("returns null for text under 150 chars with < 3 lines", () => {
    expect(summarizePaste("a\nb")).toBeNull();
  });

  it("summarizes 3-line text", () => {
    const result = summarizePaste("line1\nline2\nline3");
    expect(result).not.toBeNull();
    expect(result!.display).toBe("[Pasted #1 ~3 lines]");
    expect(result!.part.text).toBe("line1\nline2\nline3");
    expect(result!.part.virtualText).toBe("[Pasted #1 ~3 lines]");
  });

  it("summarizes text longer than 150 chars on fewer lines", () => {
    const longLine = "a".repeat(151);
    const result = summarizePaste(longLine);
    expect(result).not.toBeNull();
    expect(result!.display).toBe("[Pasted #1 ~1 lines]");
  });

  it("uses caller-provided ids in paste placeholders", () => {
    const result = summarizePaste("line1\nline2\nline3", 7);
    expect(result!.display).toBe("[Pasted #7 ~3 lines]");
    expect(result!.part.id).toBe(7);
  });

  it("returns null for text exactly 150 chars on 1 line", () => {
    const exact = "a".repeat(150);
    expect(summarizePaste(exact)).toBeNull();
  });

  it("handles CRLF input before summarizing", () => {
    const result = summarizePaste("line1\r\nline2\r\nline3");
    expect(result).not.toBeNull();
    expect(result!.part.text).toBe("line1\nline2\nline3");
  });
});

describe("expandPromptText", () => {
  it("returns input unchanged when no parts", () => {
    expect(expandPromptText({ input: "hello", parts: [] })).toBe("hello");
  });

  it("expands paste summary to original text", () => {
    const result = expandPromptText({
      input: "prefix [Pasted #1 ~3 lines] suffix",
      parts: [
        {
          id: 1,
          text: "line1\nline2\nline3",
          virtualText: "[Pasted #1 ~3 lines]",
        },
      ],
    });
    expect(result).toBe("prefix line1\nline2\nline3 suffix");
  });

  it("expands multiple paste parts", () => {
    const result = expandPromptText({
      input: "a [Pasted #1 ~2 lines] b [Pasted #2 ~3 lines] c",
      parts: [
        { id: 1, text: "x\ny", virtualText: "[Pasted #1 ~2 lines]" },
        { id: 2, text: "p\nq\nr", virtualText: "[Pasted #2 ~3 lines]" },
      ],
    });
    expect(result).toBe("a x\ny b p\nq\nr c");
  });

  it("returns input as-is when virtualText not found", () => {
    const result = expandPromptText({
      input: "no placeholder here",
      parts: [
        { id: 1, text: "content", virtualText: "[Pasted #1 ~5 lines]" },
      ],
    });
    expect(result).toBe("no placeholder here");
  });

  it("expands duplicate line-count placeholders by unique id", () => {
    const result = expandPromptText({
      input: "a [Pasted #1 ~3 lines] b [Pasted #2 ~3 lines] c",
      parts: [
        { id: 1, text: "one\ntwo\nthree", virtualText: "[Pasted #1 ~3 lines]" },
        { id: 2, text: "four\nfive\nsix", virtualText: "[Pasted #2 ~3 lines]" },
      ],
    });
    expect(result).toBe("a one\ntwo\nthree b four\nfive\nsix c");
  });
});
