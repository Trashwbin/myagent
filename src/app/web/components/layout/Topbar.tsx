import React from "react";

export function Topbar({
  sessionTitle,
  sessionId,
  projectPath,
  modelLabel,
  status,
  onCopySession,
}: {
  sessionTitle: string;
  sessionId: string | null;
  projectPath: string;
  modelLabel: string;
  status: "connecting" | "connected" | "running";
  onCopySession: () => void;
}) {
  const statusText = status === "running" ? "Running" : status === "connected" ? "Connected" : "Connecting";

  return (
    <header className="topbar">
      <div className="topbar-main">
        <strong className="session-name">{sessionTitle}</strong>
        <span className="topbar-project">{projectPath || "No project selected"}</span>
      </div>
      <details className="topbar-actions">
        <summary className="topbar-actions-trigger" aria-label="Session actions">
          <span
            aria-hidden="true"
            className={`dot ${status === "connected" ? "connected" : status === "running" ? "running" : ""}`}
          />
          <span aria-hidden="true" className="topbar-actions-icon" />
        </summary>
        <div className="topbar-actions-panel">
          <div className="topbar-action-row">
            <span className="topbar-action-label">Status</span>
            <span className="topbar-action-value">{statusText}</span>
          </div>
          <div className="topbar-action-row">
            <span className="topbar-action-label">Model</span>
            <span className="topbar-action-value">{modelLabel}</span>
          </div>
          <div className="topbar-action-row">
            <span className="topbar-action-label">Session</span>
            <span className="topbar-action-value mono">{sessionId || "session"}</span>
          </div>
          <div className="topbar-action-row">
            <span className="topbar-action-label">Project</span>
            <span className="topbar-action-value mono">{projectPath || "project"}</span>
          </div>
          <button className="topbar-copy-button" onClick={onCopySession} disabled={!sessionId}>
            Copy session ID
          </button>
        </div>
      </details>
      <button className="topbar-icon-button" type="button" aria-label="Layout">
        <span aria-hidden="true" className="layout-icon" />
      </button>
      <button className="topbar-icon-button" type="button" aria-label="Expand">
        <span aria-hidden="true" className="expand-icon" />
      </button>
    </header>
  );
}
