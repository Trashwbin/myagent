import React from "react";
import type { TimelineCompactionPart, TimelinePart } from "../../state/types.js";
import { AssistantMarkdown } from "../../markdown.js";
import { Icon } from "../icons/Icon.js";
import { ToolPartView } from "./parts/ToolPartView.js";

function formatTokenCount(value: number | undefined) {
  if (value === undefined) return undefined;
  if (value >= 1_000_000)
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

function CompactBoundary({ part }: { part: TimelineCompactionPart }) {
  const before = formatTokenCount(part.beforeTokens);
  const after = formatTokenCount(part.afterTokens);
  const tokenLabel = before && after ? `${before} -> ${after} tokens` : undefined;
  const countLabel =
    part.compactedCount !== undefined || part.retainedCount !== undefined
      ? [
          part.compactedCount !== undefined ? `${part.compactedCount} compacted` : "",
          part.retainedCount !== undefined ? `${part.retainedCount} retained` : "",
        ]
          .filter(Boolean)
          .join(", ")
      : undefined;

  return (
    <div className="compact-boundary">
      <Icon name="compact" className="compact-boundary-icon" />
      <div className="compact-boundary-main">
        <div className="compact-boundary-title">
          {part.auto ? "Conversation auto-compacted" : "Conversation compacted"}
        </div>
        <div className="compact-boundary-meta">
          {[countLabel, tokenLabel, part.transcriptTruncated ? "truncated" : ""]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
    </div>
  );
}

export function AssistantParts({ parts }: { parts: TimelinePart[] }) {
  return (
    <div className="assistant-parts">
      {parts.map((part) => {
        if (part.kind === "text") {
          return (
            <div key={part.id} className="message assistant">
              <div className="content">
                <AssistantMarkdown text={part.text} />
              </div>
            </div>
          );
        }
        if (part.kind === "status") {
          return (
            <div
              key={part.id}
              className={`status-line ${part.level === "error" ? "error" : part.level === "warning" ? "warning" : ""}`}
            >
              {part.text}
            </div>
          );
        }
        if (part.kind === "compaction") {
          return <CompactBoundary key={part.id} part={part} />;
        }
        return <ToolPartView key={part.id} part={part} />;
      })}
    </div>
  );
}
