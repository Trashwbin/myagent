import React from "react";
import type { TimelinePart, TimelineToolPart, TimelineTurn } from "../../../state/types.js";
import { AssistantMarkdown } from "../../../markdown.js";
import { Icon } from "../../icons/Icon.js";
import { ContextToolGroup } from "./ContextToolGroup.js";
import { ToolBatchView } from "./ToolBatchView.js";
import { batchAssistantParts, batchIconName, summarizeToolTrace } from "./tool-batch.js";

function durationLabel(turn: TimelineTurn) {
  if (!turn.createdAt || !turn.completedAt || turn.completedAt < turn.createdAt) {
    return "Worked";
  }
  const seconds = Math.max(1, Math.round((turn.completedAt - turn.createdAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes <= 0) return `Worked for ${seconds}s`;
  return `Worked for ${minutes}m ${remainder}s`;
}

function hasActiveTool(tools: TimelineToolPart[]) {
  return tools.some((tool) =>
    tool.status === "queued" || tool.status === "running" || tool.status === "approval",
  );
}

function TracePartView({ part }: { part: TimelinePart }) {
  if (part.kind === "text") {
    return (
      <div className="turn-trace-note">
        <AssistantMarkdown text={part.text} />
      </div>
    );
  }
  if (part.kind === "status") {
    return (
      <div className={`turn-trace-status ${part.level === "error" ? "error" : part.level === "warning" ? "warning" : ""}`}>
        {part.text}
      </div>
    );
  }
  return null;
}

export function TurnToolTrace({
  turn,
  parts = turn.assistantParts,
}: {
  turn: TimelineTurn;
  parts?: TimelinePart[];
}) {
  const tools = parts.filter(
    (part): part is TimelineToolPart => part.kind === "tool",
  );
  if (parts.length === 0 || tools.length === 0) return null;

  const active = hasActiveTool(tools);
  const collapsed = !!turn.completed && !active;
  const summary = summarizeToolTrace(tools);
  const batches = batchAssistantParts(parts);
  const iconName = batchIconName(tools);

  return (
    <details className={`turn-tool-trace${active ? " live" : ""}`} open={!collapsed}>
      <summary className="turn-tool-trace-summary">
        <Icon name={iconName} className="tool-row-icon" />
        <span className="turn-tool-trace-title">{durationLabel(turn)}</span>
        {summary ? <span className="turn-tool-trace-meta">{summary}</span> : null}
      </summary>
      <div className="turn-tool-trace-body">
        {batches.map((entry, index) => {
          if (entry.kind !== "batch") {
            return <TracePartView key={`part:${entry.part.id}`} part={entry.part} />;
          }
          const contextOnly = entry.tools.every((tool) => tool.displayKind === "context");
          if (contextOnly) {
            return <ContextToolGroup key={`context:${index}`} parts={entry.tools} />;
          }
          return (
            <ToolBatchView
              key={`batch:${index}`}
              tools={entry.tools}
              active={entry.active}
              collapsed={false}
            />
          );
        })}
      </div>
    </details>
  );
}
