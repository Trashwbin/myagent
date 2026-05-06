import React from "react";
import type { MutationDiffFile } from "../../state/types.js";
import { InlineDiff } from "../diff/InlineDiff.js";
import { reviewStatus, splitReviewPath } from "./review-utils.js";

function statusLabel(status: ReturnType<typeof reviewStatus>) {
  switch (status) {
    case "added":
      return "Added";
    case "deleted":
      return "Removed";
    default:
      return "Modified";
  }
}

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
      className="review-file"
      open={open}
      onToggle={(event) => {
        onToggle(file.path, (event.currentTarget as HTMLDetailsElement).open);
      }}
    >
      <summary className="review-file-summary">
        <div className="review-file-main">
          <div className="review-file-name-group">
            {parts.directory ? (
              <span className="review-file-directory">{parts.directory}</span>
            ) : null}
            <span className="review-file-filename">
              {file.sensitive ? `${parts.filename} (sensitive)` : parts.filename}
            </span>
          </div>
        </div>
        <div className="review-file-meta">
          <span className={`review-file-status ${status}`}>{statusLabel(status)}</span>
          <span className="review-file-stat">
            <span className="stat-add">+{file.additions || 0}</span>
            <span className="stat-del">-{file.deletions || 0}</span>
          </span>
        </div>
      </summary>
      {file.diff ? (
        <div className="review-file-diff">
          <InlineDiff diff={file.diff} />
        </div>
      ) : null}
    </details>
  );
}
