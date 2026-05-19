import React from "react";
import type { TimelineToolPart } from "../../../state/types.js";

function summarizeFiles(part: TimelineToolPart) {
  const files = part.diffFiles ?? [];
  return files.slice(0, 3).map((file) => file.path);
}

function statusLabel(status: TimelineToolPart["status"]) {
  switch (status) {
    case "running":
      return "Running";
    case "approval":
      return "Approval";
    case "denied":
      return "Denied";
    case "invalid":
      return "Invalid";
    case "failed":
      return "Failed";
    default:
      return "Queued";
  }
}

function shouldShowStatus(status: TimelineToolPart["status"]) {
  return status !== "ok";
}

export function ToolPartView({ part }: { part: TimelineToolPart }) {
  return <ToolPartViewInner part={part} compact={false} />;
}

export function CompactToolPartView({ part }: { part: TimelineToolPart }) {
  return <ToolPartViewInner part={part} compact />;
}

function ToolPartViewInner({
  part,
  compact,
}: {
  part: TimelineToolPart;
  compact: boolean;
}) {
  const fileLabels = summarizeFiles(part);
  const hasMutationDetails = part.status !== "ok" && !!part.details;
  const isShell = part.displayKind === "shell";
  const header = (
    <div className={`tool-card-header ${isShell ? "shell" : ""}`}>
      <div className="tool-card-main">
        <div className="tool-card-title-row">
          <span className="tool-card-title">{part.title}</span>
          {shouldShowStatus(part.status) ? (
            <span className={`tool-card-status ${part.status} ${isShell ? "shell" : ""}`}>
              {statusLabel(part.status)}
            </span>
          ) : null}
        </div>
        {part.subtitle ? <div className="tool-card-subtitle">{part.subtitle}</div> : null}
        {part.displayKind === "mutation" && fileLabels.length > 0 ? (
          <div className="tool-card-files">
            {fileLabels.map((label) => (
              <span key={label} className="tool-card-file-chip">
                {label}
              </span>
            ))}
            {(part.diffFiles?.length ?? 0) > fileLabels.length ? (
              <span className="tool-card-file-chip muted">
                +{(part.diffFiles?.length ?? 0) - fileLabels.length} more
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {part.summary ? <div className="tool-card-summary">{part.summary}</div> : null}
    </div>
  );

  if (compact) {
    return (
      <div className={`tool-line tool-line-compact tool-line-${part.displayKind} ${part.status}`}>
        <div className="tool-line-main">
          <span className="tool-line-title">{part.title}</span>
          {part.subtitle ? <span className="tool-line-subtitle">{part.subtitle}</span> : null}
          {part.displayKind === "skill" && part.summary ? (
            <span className="tool-line-summary">{part.summary}</span>
          ) : null}
          {part.displayKind === "mutation" && fileLabels.length > 0 ? (
            <span className="tool-line-files">
              {fileLabels.slice(0, 2).join(", ")}
              {(part.diffFiles?.length ?? 0) > fileLabels.length ? ` +${(part.diffFiles?.length ?? 0) - fileLabels.length}` : ""}
            </span>
          ) : null}
        </div>
        {shouldShowStatus(part.status) ? (
          <span className={`tool-card-status ${part.status}`}>{statusLabel(part.status)}</span>
        ) : null}
      </div>
    );
  }

  if (part.displayKind === "mutation") {
    return (
      <div className={`tool-card tool-card-${part.displayKind} tool-card-${part.status}`}>
        {header}
        {(part.diffFiles?.length ?? 0) > 0 ? (
          <div className="tool-card-footnote">Review below</div>
        ) : null}
        {hasMutationDetails ? (
          <details className="tool-card-details">
            <summary className="tool-card-secondary-toggle">
              <span className="tool-caret">&gt;</span>
              <span className="tool-card-secondary-label">Details</span>
            </summary>
            <pre className="tool-card-output">{part.details}</pre>
          </details>
        ) : null}
      </div>
    );
  }

  if (part.details && (part.displayKind === "shell" || part.status === "failed")) {
    return (
      <div className={`tool-card tool-card-${part.displayKind} tool-card-${part.status} ${isShell ? "shell" : ""}`}>
        <details className="tool-card-details">
          <summary className="tool-card-summary-row">
            <span className="tool-caret">&gt;</span>
            {header}
          </summary>
          <pre className="tool-card-output">{part.details}</pre>
        </details>
      </div>
    );
  }

  return (
    <div className={`tool-card tool-card-${part.displayKind} tool-card-${part.status} ${isShell ? "shell" : ""}`}>
      {header}
      {part.details && part.status !== "ok" ? (
        <details className="tool-card-details">
          <summary className="tool-card-secondary-toggle">
            <span className="tool-caret">&gt;</span>
            <span className="tool-card-secondary-label">Details</span>
          </summary>
          <pre className="tool-card-output">{part.details}</pre>
        </details>
      ) : null}
    </div>
  );
}
