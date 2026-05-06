import React from "react";

function parseHunkHeader(line: string): { oldLine: number; newLine: number } | null {
  const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (!match) return null;
  return {
    oldLine: Number(match[1]),
    newLine: Number(match[2]),
  };
}

function diffLineClass(line: string): "hunk" | "file" | "add" | "del" | "ctx" {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+++") || line.startsWith("---")) return "file";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "ctx";
}

export function InlineDiff({ diff }: { diff: string }) {
  let oldLine = 0;
  let newLine = 0;
  const lines = String(diff || "").replace(/\n$/, "").split("\n");

  return (
    <div className="approval-inline-diff">
      {lines.map((rawLine, index) => {
        if (rawLine.startsWith("---") || rawLine.startsWith("+++")) return null;

        const hunk = parseHunkHeader(rawLine);
        if (hunk) {
          oldLine = hunk.oldLine;
          newLine = hunk.newLine;
          return (
            <div key={index} className="diff-row hunk">
              <span className="diff-gutter" />
              <span className="diff-marker" />
              <span className="diff-code">{rawLine}</span>
            </div>
          );
        }

        const kind = diffLineClass(rawLine);
        let number = "";
        let marker = "";
        let code = rawLine;

        if (kind === "add") {
          number = String(newLine);
          marker = "+";
          code = rawLine.slice(1);
          newLine += 1;
        } else if (kind === "del") {
          number = String(oldLine);
          marker = "-";
          code = rawLine.slice(1);
          oldLine += 1;
        } else {
          number = String(newLine || oldLine || "");
          code = rawLine.startsWith(" ") ? rawLine.slice(1) : rawLine;
          oldLine += 1;
          newLine += 1;
        }

        return (
          <div key={index} className={`diff-row ${kind === "file" ? "ctx" : kind}`}>
            <span className="diff-gutter">{number}</span>
            <span className="diff-marker">{marker}</span>
            <span className="diff-code">{code || " "}</span>
          </div>
        );
      })}
    </div>
  );
}
