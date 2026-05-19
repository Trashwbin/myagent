import React, { useMemo, useState } from "react";
import type { MutationDiffFile } from "../../state/types.js";
import { Icon } from "../icons/Icon.js";
import { ReviewDiffFile } from "./ReviewDiffFile.js";
import { summarizeReview } from "./review-utils.js";

export function TurnDiffReview({
  files,
}: {
  files: MutationDiffFile[];
}) {
  const totals = useMemo(() => summarizeReview(files), [files]);
  const [openFiles, setOpenFiles] = useState<string[]>(
    files.length === 1 ? [files[0]!.path] : [],
  );

  const allExpanded = files.length > 0 && openFiles.length === files.length;

  const toggleAll = () => {
    setOpenFiles(allExpanded ? [] : files.map((file) => file.path));
  };

  const setFileOpen = (path: string, open: boolean) => {
    setOpenFiles((current) => {
      if (open) {
        return current.includes(path) ? current : [...current, path];
      }
      return current.filter((item) => item !== path);
    });
  };

  return (
    <div className="diff-card">
      <div className="diff-card-header">
        <div className="diff-card-stats">
          <span className="diff-card-count">{totals.files} files changed</span>
          <span className="diff-card-add">+{totals.additions}</span>
          <span className="diff-card-del">-{totals.deletions}</span>
        </div>
        <button className="diff-card-toggle" onClick={toggleAll}>
          {allExpanded ? "Collapse" : "Review"}
          <Icon
            name={allExpanded ? "chevron-up" : "arrow-right"}
            className="diff-card-toggle-mark"
          />
        </button>
      </div>
      <div className="diff-card-files">
        {files.map((file) => (
          <ReviewDiffFile
            key={file.path}
            file={file}
            open={openFiles.includes(file.path)}
            onToggle={setFileOpen}
          />
        ))}
      </div>
    </div>
  );
}
