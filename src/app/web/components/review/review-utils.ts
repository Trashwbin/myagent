import type { MutationDiffFile } from "../../state/types.js";

export type ReviewStatus = "added" | "deleted" | "modified";

export function splitReviewPath(path: string): {
  directory: string;
  filename: string;
} {
  const normalized = String(path || "").replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index < 0) return { directory: "", filename: normalized };
  return {
    directory: normalized.slice(0, index + 1),
    filename: normalized.slice(index + 1),
  };
}

export function reviewStatus(file: MutationDiffFile): ReviewStatus {
  if (file.additions > 0 && file.deletions === 0) return "added";
  if (file.deletions > 0 && file.additions === 0) return "deleted";
  return "modified";
}

export function summarizeReview(files: MutationDiffFile[]) {
  return files.reduce(
    (acc, file) => {
      acc.additions += file.additions || 0;
      acc.deletions += file.deletions || 0;
      return acc;
    },
    {
      files: files.length,
      additions: 0,
      deletions: 0,
    },
  );
}
