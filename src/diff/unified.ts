export type UnifiedDiffFile = {
  path: string;
  additions: number;
  deletions: number;
  diff: string;
};

export function parseUnifiedDiffFiles(text: string): UnifiedDiffFile[] {
  const raw = String(text || "").replace(/\n$/, "");
  const lines = raw.split("\n");
  const files: Array<{
    path: string;
    lines: string[];
    additions: number;
    deletions: number;
  }> = [];
  let current: {
    path: string;
    lines: string[];
    additions: number;
    deletions: number;
  } | null = null;

  for (const line of lines) {
    const oldPath = parseHeaderPath(line, "--- ");
    if (oldPath !== undefined) {
      if (current) files.push(current);
      current = {
        path: oldPath,
        lines: [line],
        additions: 0,
        deletions: 0,
      };
      continue;
    }
    if (!current) continue;
    current.lines.push(line);
    const newPath = parseHeaderPath(line, "+++ ");
    if (newPath !== undefined) {
      if (newPath !== "/dev/null") current.path = newPath;
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) current.additions++;
    if (line.startsWith("-") && !line.startsWith("---")) current.deletions++;
  }

  if (current) files.push(current);
  return files
    .filter((file) => file.lines.some((line) => line.startsWith("@@")))
    .map((file) => ({
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      diff: file.lines.join("\n"),
    }));
}

function parseHeaderPath(
  line: string,
  marker: "--- " | "+++ ",
): string | undefined {
  if (!line.startsWith(marker)) return undefined;
  const rawPath = line.slice(marker.length).trim();
  if (rawPath === "/dev/null") return rawPath;
  if (rawPath.startsWith("a/") || rawPath.startsWith("b/")) {
    return cleanDiffPath(rawPath.slice(2));
  }
  return cleanDiffPath(rawPath);
}

function cleanDiffPath(path: string): string {
  return String(path || "")
    .replace(/^\/+/, "")
    .replace(/^Users\/[^/]+\/code\/pre\/myAgents\/myAgent\//, "")
    .replace(/^\/dev\/null$/, "/dev/null");
}
