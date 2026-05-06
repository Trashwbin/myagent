import { describe, expect, it } from "vitest";
import { parseUnifiedDiffFiles } from "../src/diff/unified.js";

describe("parseUnifiedDiffFiles", () => {
  it("parses nested paths and preserves same basenames as separate files", () => {
    const files = parseUnifiedDiffFiles(
      [
        "--- a/src/a/index.ts",
        "+++ b/src/a/index.ts",
        "@@ -1 +1 @@",
        "-const value = 'a';",
        "+const value = 'aa';",
        "--- a/src/b/index.ts",
        "+++ b/src/b/index.ts",
        "@@ -1 +1 @@",
        "-const value = 'b';",
        "+const value = 'bb';",
      ].join("\n"),
    );

    expect(files).toEqual([
      {
        path: "src/a/index.ts",
        additions: 1,
        deletions: 1,
        diff: [
          "--- a/src/a/index.ts",
          "+++ b/src/a/index.ts",
          "@@ -1 +1 @@",
          "-const value = 'a';",
          "+const value = 'aa';",
        ].join("\n"),
      },
      {
        path: "src/b/index.ts",
        additions: 1,
        deletions: 1,
        diff: [
          "--- a/src/b/index.ts",
          "+++ b/src/b/index.ts",
          "@@ -1 +1 @@",
          "-const value = 'b';",
          "+const value = 'bb';",
        ].join("\n"),
      },
    ]);
  });
});
