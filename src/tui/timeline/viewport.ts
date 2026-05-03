import type { TimelineItem } from "./types.js";

export type TimelineDisplayLine = {
  kind: "user" | "assistant" | "tool" | "status" | "indicator" | "blank";
  text: string;
  level?: "info" | "warn" | "error";
  status?: string;
  important?: boolean;
};

export type TimelineViewport = {
  lines: TimelineDisplayLine[];
  startLine: number;
  totalLines: number;
  maxScrollOffset: number;
  scrollOffset: number;
};

export function countTimelineItemLines(item: TimelineItem): number {
  switch (item.type) {
    case "user":
      return 1;
    case "status":
      return 1;
    case "assistant": {
      let lines = 0;
      for (const part of item.parts) {
        if (part.type === "text") {
          if (!part.text) continue;
          lines += Math.max(1, part.text.split("\n").length);
        } else {
          lines += 1;
          if (part.tool.detail && part.tool.status !== "ok") {
            lines += Math.min(2, part.tool.detail.split("\n").length);
          }
        }
      }
      return lines || 1;
    }
  }
}

export function timelineLineCount(timeline: TimelineItem[]): number {
  return timeline.reduce((sum, item) => sum + countTimelineItemLines(item), 0);
}

function toolStatusIcon(status: string): string {
  switch (status) {
    case "ok":
      return "✓";
    case "failed":
    case "denied":
      return "✗";
    case "invalid":
      return "!";
    case "approval":
      return "?";
    case "running":
      return "●";
    case "queued":
      return "○";
    default:
      return " ";
  }
}

export function timelineToDisplayLines(
  timeline: TimelineItem[],
): TimelineDisplayLine[] {
  const lines: TimelineDisplayLine[] = [];

  for (const item of timeline) {
    switch (item.type) {
      case "user":
        lines.push({ kind: "user", text: `> ${item.text}` });
        break;
      case "status":
        lines.push({ kind: "status", level: item.level, text: item.text });
        break;
      case "assistant":
        if (item.parts.length === 0) {
          lines.push({ kind: "assistant", text: "..." });
          break;
        }

        for (const part of item.parts) {
          if (part.type === "text") {
            if (!part.text) continue;
            for (const line of part.text.split("\n")) {
              lines.push({ kind: "assistant", text: line });
            }
            continue;
          }

          const tool = part.tool;
          const icon = toolStatusIcon(tool.status);
          const text = `  ${icon} ${tool.summary || tool.displayName}`;
          lines.push({
            kind: "tool",
            text,
            status: tool.status,
            important: tool.important,
          });
          if (tool.detail && tool.status !== "approval" && tool.status !== "ok") {
            for (const line of tool.detail.split("\n").slice(0, 2)) {
              lines.push({
                kind: "tool",
                text: `    ${line}`,
                status: tool.status,
                important: false,
              });
            }
          }
        }
        break;
    }
  }

  return lines;
}

export function maxTimelineScrollOffset(
  timeline: TimelineItem[],
  height: number,
): number {
  return Math.max(0, timelineToDisplayLines(timeline).length - Math.max(1, height));
}

export function clampTimelineScrollOffset(
  timeline: TimelineItem[],
  height: number,
  offset: number,
): number {
  return Math.min(
    Math.max(0, offset),
    maxTimelineScrollOffset(timeline, height),
  );
}

export function selectTimelineViewport(
  timeline: TimelineItem[],
  height: number,
  offset: number,
): TimelineViewport {
  const budget = Math.max(1, height);
  const allLines = timelineToDisplayLines(timeline);
  const totalLines = allLines.length;
  const maxScrollOffset = Math.max(0, totalLines - budget);
  const scrollOffset = Math.min(Math.max(0, offset), maxScrollOffset);
  const startLine = Math.max(0, totalLines - budget - scrollOffset);

  return {
    lines: allLines.slice(startLine, startLine + budget),
    startLine,
    totalLines,
    maxScrollOffset,
    scrollOffset,
  };
}
