import React from "react";
import type { TimelineToolPart } from "../../../state/types.js";
import { Icon } from "../../icons/Icon.js";

function summarize(parts: TimelineToolPart[]) {
  const read = parts.filter((part) => part.toolName === "Read" || part.toolName === "read_file").length;
  const search = parts.filter((part) => part.toolName === "grep" || part.toolName === "glob").length;
  const browse = parts.filter((part) => part.toolName === "list_dir" || part.toolName === "find_up").length;
  return { read, search, browse };
}

export function ContextToolGroup({ parts }: { parts: TimelineToolPart[] }) {
  const counts = summarize(parts);
  const summary = [
    counts.read ? `${counts.read} read` : "",
    counts.search ? `${counts.search} search` : "",
    counts.browse ? `${counts.browse} browse` : "",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <details className="tool-context-group">
      <summary className="tool-context-summary">
        <span className="tool-context-main">
          <Icon name="search" className="tool-row-icon" />
          <span className="tool-context-title">Gathered context</span>
        </span>
        <span className="tool-context-meta">{summary || `${parts.length} operations`}</span>
      </summary>
      <div className="tool-context-items">
        {parts.map((part) => (
          <div key={part.id} className={`tool-line ${part.status}`}>
            <span className="tool-header">
              <span className="tool-title">{part.title}</span>
              {part.subtitle ? <span className="tool-summary">{part.subtitle}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}
