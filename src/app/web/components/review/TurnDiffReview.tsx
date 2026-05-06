import React, { useMemo, useState } from "react";
import type { MutationDiffFile } from "../../state/types.js";
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
    <section className="turn-review">
      <div className="turn-review-header">
        <div className="turn-review-heading">
          <span className="turn-review-title">Review changes</span>
          <span className="turn-review-meta">
            {totals.files} files
          </span>
        </div>
        <div className="turn-review-actions">
          <span className="turn-review-statline">
            <span className="stat-add">+{totals.additions}</span>
            <span className="stat-del">-{totals.deletions}</span>
          </span>
          <button className="turn-review-toggle" onClick={toggleAll}>
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
        </div>
      </div>
      <div className="turn-review-files">
        {files.map((file) => (
          <ReviewDiffFile
            key={file.path}
            file={file}
            open={openFiles.includes(file.path)}
            onToggle={setFileOpen}
          />
        ))}
      </div>
    </section>
  );
}
