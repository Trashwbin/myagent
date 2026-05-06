import React from "react";
import type { MutationDiffFile } from "../../state/types.js";
import { InlineDiff } from "./InlineDiff.js";

export function DiffFileAccordion({
  file,
  defaultOpen = false,
}: {
  file: MutationDiffFile;
  defaultOpen?: boolean;
}) {
  return (
    <details className="diff-file" open={defaultOpen}>
      <summary>
        <span className="diff-file-name">
          {file.sensitive ? `${file.path} (sensitive)` : file.path}
        </span>
        <span className="diff-file-stat">
          <span className="stat-add">+{file.additions || 0}</span>
          <span className="stat-del">-{file.deletions || 0}</span>
        </span>
      </summary>
      {file.diff ? <InlineDiff diff={file.diff} /> : null}
    </details>
  );
}
