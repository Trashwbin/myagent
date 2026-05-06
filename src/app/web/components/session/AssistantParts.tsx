import React from "react";
import type { TimelinePart } from "../../state/types.js";
import { AssistantMarkdown } from "../../markdown.js";
import { ContextToolGroup } from "./parts/ContextToolGroup.js";
import { ToolBatchView } from "./parts/ToolBatchView.js";
import { ToolPartView } from "./parts/ToolPartView.js";
import { batchAssistantParts } from "./parts/tool-batch.js";

export function AssistantParts({
  parts,
  turnCompleted,
}: {
  parts: TimelinePart[];
  turnCompleted?: boolean;
}) {
  const batches = batchAssistantParts(parts);

  return (
    <div className="assistant-parts">
      {batches.map((entry, index) => {
        if (entry.kind === "batch") {
          const contextOnly = entry.tools.every((tool) => tool.displayKind === "context");
          if (contextOnly) {
            return <ContextToolGroup key={`context:${index}`} parts={entry.tools} />;
          }
          return (
            <ToolBatchView
              key={`batch:${index}`}
              tools={entry.tools}
              active={entry.active}
              collapsed={!!turnCompleted}
            />
          );
        }
        const part = entry.part;
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
            <div key={part.id} className={`status-line ${part.level === "error" ? "error" : part.level === "warning" ? "warning" : ""}`}>
              {part.text}
            </div>
          );
        }
        return <ToolPartView key={part.id} part={part} />;
      })}
    </div>
  );
}
