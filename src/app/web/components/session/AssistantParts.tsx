import React from "react";
import type { TimelinePart } from "../../state/types.js";
import { AssistantMarkdown } from "../../markdown.js";
import { ToolPartView } from "./parts/ToolPartView.js";

export function AssistantParts({
  parts,
}: {
  parts: TimelinePart[];
}) {
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
