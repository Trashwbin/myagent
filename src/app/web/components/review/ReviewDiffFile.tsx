import React from "react";
import type { MutationDiffFile } from "../../state/types.js";
import { InlineDiff } from "../diff/InlineDiff.js";
import { reviewStatus, splitReviewPath } from "./review-utils.js";

export function ReviewDiffFile({
  file,
  open,
  onToggle,
}: {
  file: MutationDiffFile;
  open: boolean;
  onToggle: (path: string, open: boolean) => void;
}) {
  const parts = splitReviewPath(file.path);
  const status = reviewStatus(file);

  return (
    <details
      className="diff-card-file"
      open={open}
      onToggle={(event) => {
        onToggle(file.path, (event.currentTarget as HTMLDetailsElement).open);
      }}
    >
      <summary className="diff-card-file-row">
        <span className="diff-card-file-name">
          {parts.directory ? `${parts.directory}` : ""}
          {parts.filename}
        </span>
        <div className="diff-card-file-meta">
          <span className="diff-card-file-stat diff-card-file-add">+{file.additions || 0}</span>
          <span className="diff-card-file-stat diff-card-file-del">-{file.deletions || 0}</span>
          <span className={`diff-card-dot ${status}`} />
        </div>
      </summary>
      {file.diff ? (
        <div className="diff-card-file-content">
          <InlineDiff diff={file.diff} />
        </div>
      ) : null}
    </details>
  );
}
