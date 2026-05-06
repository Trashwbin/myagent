import React from "react";
import type { ApprovalRequest } from "../../../../session/loop.js";
import type { MutationFileInfo } from "../../../../permission/display.js";
import { DiffFileAccordion } from "../diff/DiffFileAccordion.js";

function filesFromRequest(request: ApprovalRequest): MutationFileInfo[] {
  if (request.display?.kind === "mutation") return request.display.files;
  return [];
}

function fieldsFromRequest(request: ApprovalRequest): Array<{ label: string; value: string }> {
  if (request.display?.kind === "access") {
    return [
      { label: "Path", value: request.display.subject },
      ...(request.display.scope ? [{ label: "Scope", value: request.display.scope }] : []),
    ];
  }
  if (request.display?.kind === "command") {
    return [{ label: "Command", value: request.display.subject }];
  }
  return [];
}

export function ApprovalDock({
  request,
  selectedIndex,
  onSelect,
  onSubmit,
}: {
  request: ApprovalRequest;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onSubmit: () => void;
}) {
  const files = filesFromRequest(request);
  const fields = fieldsFromRequest(request);
  const heading = request.display?.prompt || "Approval required";

  const options = [
    { label: "Allow once" },
    { label: "Allow session" },
    { label: "Allow workspace" },
    { label: "Deny" },
  ];

  return (
    <section className="approval visible">
      <div className="approval-title">{heading}</div>
      <div className="approval-body">
        {fields.length > 0 ? (
          <div className="approval-fields">
            {fields.map((field) => (
              <div key={field.label} className="approval-field">
                <div className="approval-label">{field.label}</div>
                <div className="approval-value">{field.value}</div>
              </div>
            ))}
          </div>
        ) : null}
        {files.length > 0 ? (
          <div className="approval-file-list">
            {files.map((file) => (
              <DiffFileAccordion key={file.path} file={file} />
            ))}
          </div>
        ) : null}
      </div>
      <div className="approval-options">
        {options.map((option, index) => (
          <button
            key={option.label}
            className={`approval-option${selectedIndex === index ? " selected" : ""}${index === 3 ? " muted" : ""}`}
            onClick={() => onSelect(index)}
          >
            <span className="option-index">{index + 1}.</span>
            <span>{option.label}</span>
            {index === 0 ? <span className="option-hint">↑ ↓</span> : null}
          </button>
        ))}
      </div>
      <div className="approval-submit">
        <button className="submit-button" onClick={onSubmit}>
          Submit <span>↵</span>
        </button>
      </div>
    </section>
  );
}
