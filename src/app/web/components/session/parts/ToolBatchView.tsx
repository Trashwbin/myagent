import React from "react";
import type { TimelineToolPart } from "../../../state/types.js";
import { CompactToolPartView } from "./ToolPartView.js";
import { summarizeBatch } from "./tool-batch.js";

function isShellBatch(tools: TimelineToolPart[]) {
  return tools.length > 0 && tools.every((tool) => tool.displayKind === "shell");
}

function commandText(tool: TimelineToolPart) {
  return tool.subtitle || tool.summary || tool.title;
}

function commandOutput(tool: TimelineToolPart) {
  const command = commandText(tool);
  const details = (tool.details || "").trim();
  if (!details || details === `Command completed with no output: ${command}`) {
    return "No output";
  }
  return details;
}

function commandStatus(tool: TimelineToolPart) {
  switch (tool.status) {
    case "running":
      return "Running";
    case "failed":
    case "invalid":
      return "Failed";
    case "denied":
      return "Denied";
    case "approval":
      return "Approval";
    case "ok":
      return "Success";
    default:
      return "Queued";
  }
}

function ShellCommandBatch({
  tools,
  active,
  collapsed,
}: {
  tools: TimelineToolPart[];
  active: boolean;
  collapsed: boolean;
}) {
  const summary = `Ran ${tools.length} ${tools.length === 1 ? "command" : "commands"}`;
  return (
    <details
      className={`shell-command-batch${active ? " live" : ""}`}
      open={active || !collapsed}
    >
      <summary className="shell-command-batch-summary">
        <span className="shell-command-icon" aria-hidden="true">
          ▹
        </span>
        <span>{summary}</span>
        <span className="shell-command-caret" aria-hidden="true">
          ⌄
        </span>
      </summary>
      {active || !collapsed ? (
        <div className="shell-command-list">
          {tools.map((tool, index) => {
            const command = commandText(tool);
            return (
              <details key={tool.id} className="shell-command-item" open={index === 0}>
                <summary className="shell-command-row">
                  <span>Ran {command}</span>
                  <span className="shell-command-caret" aria-hidden="true">
                    ⌄
                  </span>
                </summary>
                <div className="shell-terminal">
                  <div className="shell-terminal-label">Shell</div>
                  <pre className="shell-terminal-body">
                    <span className="shell-prompt">$</span>
                    {` ${command}\n\n${commandOutput(tool)}`}
                  </pre>
                  <div className={`shell-terminal-status ${tool.status}`}>
                    {tool.status === "ok" ? "✓ " : ""}
                    {commandStatus(tool)}
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      ) : null}
    </details>
  );
}

export function ToolBatchView({
  tools,
  active,
  collapsed,
}: {
  tools: TimelineToolPart[];
  active: boolean;
  collapsed: boolean;
}) {
  const summary = summarizeBatch(tools) || `${tools.length} operations`;

  if (isShellBatch(tools)) {
    return <ShellCommandBatch tools={tools} active={active} collapsed={collapsed} />;
  }

  if (active) {
    return (
      <section className="tool-batch live">
        <div className="tool-batch-header">
          <span className="tool-batch-title">{summary}</span>
        </div>
        <div className="tool-batch-items">
          {tools.map((tool) => (
            <CompactToolPartView key={tool.id} part={tool} />
          ))}
        </div>
      </section>
    );
  }

  return (
    <details className="tool-batch collapsed" open={!collapsed}>
      <summary className="tool-batch-summary">
        <span className="tool-batch-caret">{collapsed ? "▸" : "▾"}</span>
        <span className="tool-batch-title">{summary}</span>
      </summary>
      {!collapsed ? (
        <div className="tool-batch-items readonly">
          {tools.map((tool) => (
            <CompactToolPartView key={tool.id} part={tool} />
          ))}
        </div>
      ) : null}
    </details>
  );
}
