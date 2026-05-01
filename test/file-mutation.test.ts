import { describe, it, expect } from "vitest";
import {
  computeDiff,
  detectLineEnding,
  normalizeToLf,
  applyLineEnding,
  ReadStateTracker,
} from "../src/tools/file-mutation.js";

describe("detectLineEnding", () => {
  it("detects LF", () => {
    expect(detectLineEnding("a\nb\nc")).toBe("lf");
  });

  it("detects CRLF", () => {
    expect(detectLineEnding("a\r\nb\r\nc")).toBe("crlf");
  });

  it("defaults to LF when no line endings", () => {
    expect(detectLineEnding("oneline")).toBe("lf");
  });
});

describe("normalizeToLf", () => {
  it("converts CRLF to LF", () => {
    expect(normalizeToLf("a\r\nb\r\nc")).toBe("a\nb\nc");
  });

  it("leaves LF unchanged", () => {
    expect(normalizeToLf("a\nb\nc")).toBe("a\nb\nc");
  });
});

describe("applyLineEnding", () => {
  it("converts LF to CRLF", () => {
    expect(applyLineEnding("a\nb\nc", "crlf")).toBe("a\r\nb\r\nc");
  });

  it("leaves LF as LF", () => {
    expect(applyLineEnding("a\nb\nc", "lf")).toBe("a\nb\nc");
  });
});

describe("computeDiff", () => {
  it("returns empty diff for identical content", () => {
    const result = computeDiff("hello\nworld\n", "hello\nworld\n", "test.txt");
    expect(result.diff).toBe("");
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(0);
  });

  it("detects single line change", () => {
    const result = computeDiff("hello\nworld\n", "hello\nearth\n", "test.txt");
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
    expect(result.diff).toContain("-world");
    expect(result.diff).toContain("+earth");
  });

  it("detects additions", () => {
    const result = computeDiff("hello\n", "hello\nworld\n", "test.txt");
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(0);
    expect(result.diff).toContain("+world");
  });

  it("detects deletions", () => {
    const result = computeDiff("hello\nworld\n", "hello\n", "test.txt");
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(1);
    expect(result.diff).toContain("-world");
  });

  it("includes diff header with filename", () => {
    const result = computeDiff("a\n", "b\n", "myfile.ts");
    expect(result.diff).toContain("myfile.ts");
  });

  it("handles completely different content", () => {
    const result = computeDiff("aaa\nbbb\nccc\n", "xxx\nyyy\nzzz\n", "test.txt");
    expect(result.additions).toBe(3);
    expect(result.deletions).toBe(3);
  });
});

describe("ReadStateTracker", () => {
  it("records and retrieves read state", () => {
    const tracker = new ReadStateTracker();
    tracker.record({
      path: "test.txt",
      realPath: "/workspace/test.txt",
      mtimeMs: 1000,
      readAt: Date.now(),
      partial: false,
    });

    const state = tracker.get("/workspace/test.txt");
    expect(state).toBeDefined();
    expect(state!.path).toBe("test.txt");
    expect(state!.mtimeMs).toBe(1000);
    expect(state!.partial).toBe(false);
  });

  it("hasFullRead returns true for non-partial read", () => {
    const tracker = new ReadStateTracker();
    tracker.record({
      path: "test.txt",
      realPath: "/workspace/test.txt",
      mtimeMs: 1000,
      readAt: Date.now(),
      partial: false,
    });

    expect(tracker.hasFullRead("/workspace/test.txt")).toBe(true);
  });

  it("hasFullRead returns false for partial read", () => {
    const tracker = new ReadStateTracker();
    tracker.record({
      path: "test.txt",
      realPath: "/workspace/test.txt",
      mtimeMs: 1000,
      readAt: Date.now(),
      partial: true,
    });

    expect(tracker.hasFullRead("/workspace/test.txt")).toBe(false);
  });

  it("hasFullRead returns false for unread file", () => {
    const tracker = new ReadStateTracker();
    expect(tracker.hasFullRead("/workspace/test.txt")).toBe(false);
  });

  it("updateAfterWrite updates mtimeMs", () => {
    const tracker = new ReadStateTracker();
    tracker.record({
      path: "test.txt",
      realPath: "/workspace/test.txt",
      mtimeMs: 1000,
      readAt: Date.now(),
      partial: false,
    });

    tracker.updateAfterWrite("/workspace/test.txt", 2000);

    const state = tracker.get("/workspace/test.txt");
    expect(state!.mtimeMs).toBe(2000);
  });

  it("updateAfterWrite creates entry if missing", () => {
    const tracker = new ReadStateTracker();
    tracker.updateAfterWrite("/workspace/test.txt", 2000);

    const state = tracker.get("/workspace/test.txt");
    expect(state).toBeDefined();
    expect(state!.mtimeMs).toBe(2000);
    expect(state!.partial).toBe(false);
  });
});
