import React from "react";
import type { TimelineToolPart, TimelineTurn } from "../../../state/types.js";
import { ContextToolGroup } from "./ContextToolGroup.js";
import { ToolBatchView } from "./ToolBatchView.js";
import { batchAssistantParts, summarizeToolTrace } from "./tool-batch.js";

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

export function TurnToolTrace({ turn }: { turn: TimelineTurn }) {
  const tools = turn.assistantParts.filter(
    (part): part is TimelineToolPart => part.kind === "tool",
  );
  if (tools.length === 0) return null;

  const active = hasActiveTool(tools);
  const collapsed = !!turn.completed && !active;
  const summary = summarizeToolTrace(tools);
  const batches = batchAssistantParts(tools);

  return (
    <details className={`turn-tool-trace${active ? " live" : ""}`} open={!collapsed}>
      <summary className="turn-tool-trace-summary">
        <span className="turn-tool-trace-title">{durationLabel(turn)}</span>
        {summary ? <span className="turn-tool-trace-meta">{summary}</span> : null}
        <span className="turn-tool-trace-caret" aria-hidden="true">
          ›
        </span>
      </summary>
      <div className="turn-tool-trace-body">
        {batches.map((entry, index) => {
          if (entry.kind !== "batch") return null;
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
