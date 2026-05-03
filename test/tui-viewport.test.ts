import { describe, expect, it } from "vitest";
import type { TimelineItem } from "../src/tui/timeline/types.js";
import {
  clampTimelineScrollOffset,
  countTimelineItemLines,
  maxTimelineScrollOffset,
  selectTimelineViewport,
  timelineLineCount,
  timelineToDisplayLines,
} from "../src/tui/timeline/viewport.js";

function user(text: string): TimelineItem {
  return { type: "user", text };
}

function assistant(text: string): TimelineItem {
  return { type: "assistant", parts: [{ type: "text", text }] };
}

function assistantWithTool(text: string): TimelineItem {
  return {
    type: "assistant",
    parts: [
      { type: "text", text },
      {
        type: "tool",
        tool: {
          callId: "tc1",
          name: "Read",
          displayName: "Read",
          status: "ok",
          summary: "Read 10 lines",
          important: false,
        },
      },
    ],
  };
}

describe("timeline viewport", () => {
  it("counts assistant text and tool lines", () => {
    expect(countTimelineItemLines(user("hello"))).toBe(1);
    expect(countTimelineItemLines(assistant("one\ntwo"))).toBe(2);
    expect(countTimelineItemLines(assistantWithTool("answer"))).toBe(2);
  });

  it("selects the tail when scroll offset is zero", () => {
    const timeline = [
      user("first"),
      assistant("first answer"),
      user("second"),
      assistant("second answer"),
    ];

    const viewport = selectTimelineViewport(timeline, 3, 0);
    expect(viewport.lines.map((line) => line.text)).toEqual([
      "first answer",
      "> second",
      "second answer",
    ]);
    expect(viewport.scrollOffset).toBe(0);
  });

  it("can reveal earlier rounds with scroll offset", () => {
    const timeline = [
      user("first"),
      assistant("first answer"),
      user("second"),
      assistant("second answer"),
    ];

    const viewport = selectTimelineViewport(timeline, 3, 2);
    expect(viewport.lines.map((line) => line.text)).toEqual([
      "> first",
      "first answer",
      "> second",
    ]);
    expect(viewport.scrollOffset).toBe(1);
  });

  it("clamps scroll offset to available history", () => {
    const timeline = [user("first"), assistant("answer")];
    expect(timelineLineCount(timeline)).toBe(2);
    expect(maxTimelineScrollOffset(timeline, 10)).toBe(0);
    expect(clampTimelineScrollOffset(timeline, 10, 100)).toBe(0);
  });

  it("turns timeline items into display lines for line-level scrolling", () => {
    const lines = timelineToDisplayLines([
      user("question"),
      assistantWithTool("answer"),
      { type: "status", level: "warn", text: "truncated" },
    ]);

    expect(lines.map((line) => line.text)).toEqual([
      "> question",
      "answer",
      "  ✓ Read 10 lines",
      "truncated",
    ]);
  });
});
