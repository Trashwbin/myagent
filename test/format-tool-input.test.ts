import { describe, it, expect } from "vitest";
import { formatToolInputSummary } from "../src/cli/format-tool-input.js";

describe("formatToolInputSummary", () => {
  it("formats search input", () => {
    const result = formatToolInputSummary({
      pattern: "TODO",
      path: "src/",
      exclude: ["node_modules"],
      max_results: 100,
    });
    expect(result).toContain('pattern: "TODO"');
    expect(result).toContain('path: "src/"');
    expect(result).toContain('exclude: ["node_modules"]');
    expect(result).toContain("max_results: 100");
  });

  it("formats list_dir input", () => {
    const result = formatToolInputSummary({ path: "/tmp/project" });
    expect(result).toBe('path: "/tmp/project"');
  });

  it("formats read_file input", () => {
    const result = formatToolInputSummary({ path: "app.ts" });
    expect(result).toBe('path: "app.ts"');
  });

  it("formats bash command", () => {
    const result = formatToolInputSummary({ command: "git status" });
    expect(result).toBe('command: "git status"');
  });

  it("formats edit_file with short strings", () => {
    const result = formatToolInputSummary({
      path: "app.ts",
      old_string: "hello",
      new_string: "world",
    });
    expect(result).toContain('path: "app.ts"');
    expect(result).toContain('old_string: "hello"');
    expect(result).toContain('new_string: "world"');
  });

  it("truncates long content fields", () => {
    const longContent = "x".repeat(200);
    const result = formatToolInputSummary({
      path: "app.ts",
      content: longContent,
    });
    expect(result).toContain("path: \"app.ts\"");
    expect(result).not.toContain(longContent);
    expect(result).toContain("…");
    // Should show first 120 chars
    expect(result).toContain("x".repeat(120));
  });

  it("truncates long patch content", () => {
    const longPatch = "*** Begin Patch\n" + "+line\n".repeat(50) + "*** End Patch";
    const result = formatToolInputSummary({ patch: longPatch });
    expect(result).toContain("…");
    expect(result).not.toContain("*** End Patch");
  });

  it("truncates long old_string and new_string", () => {
    const long = "a".repeat(200);
    const result = formatToolInputSummary({
      path: "f.ts",
      old_string: long,
      new_string: "short",
    });
    expect(result).toContain('new_string: "short"');
    expect(result).toContain("…");
  });

  it("redacts content fields when sensitive", () => {
    const result = formatToolInputSummary(
      { path: ".env", old_string: "TOKEN=secret", new_string: "TOKEN=new" },
      { sensitive: true },
    );
    expect(result).toContain('path: ".env"');
    expect(result).toContain("old_string: [...]");
    expect(result).toContain("new_string: [...]");
    expect(result).not.toContain("TOKEN");
  });

  it("redacts write_file content when sensitive", () => {
    const result = formatToolInputSummary(
      { path: ".env", content: "SECRET=value" },
      { sensitive: true },
    );
    expect(result).toContain("content: [...]");
    expect(result).not.toContain("SECRET");
  });

  it("redacts patch content when sensitive", () => {
    const result = formatToolInputSummary(
      { patch: "*** Begin Patch\n*** End Patch" },
      { sensitive: true },
    );
    expect(result).toContain("patch: [...]");
  });

  it("filters internal fields", () => {
    const result = formatToolInputSummary({
      path: "app.ts",
      resolvedPath: "/ws/app.ts",
      realPath: "/ws/app.ts",
      excludeSensitive: true,
      resolvedPaths: { a: "/ws/a" },
    });
    expect(result).toBe('path: "app.ts"');
    expect(result).not.toContain("resolvedPath");
    expect(result).not.toContain("realPath");
    expect(result).not.toContain("excludeSensitive");
    expect(result).not.toContain("resolvedPaths");
  });

  it("returns empty string for empty input", () => {
    expect(formatToolInputSummary(null)).toBe("");
    expect(formatToolInputSummary(undefined)).toBe("");
    expect(formatToolInputSummary("")).toBe("");
    expect(formatToolInputSummary({})).toBe("");
  });

  it("truncates very long non-content strings", () => {
    const longPath = "/".repeat(300);
    const result = formatToolInputSummary({ path: longPath });
    expect(result).toContain("…");
    expect(result).not.toContain(longPath);
  });

  it("handles arrays and numbers", () => {
    const result = formatToolInputSummary({
      exclude: ["a", "b"],
      max_results: 50,
    });
    expect(result).toContain('exclude: ["a","b"]');
    expect(result).toContain("max_results: 50");
  });

  it("sensitive flag redacts all content fields even for short values", () => {
    const result = formatToolInputSummary(
      {
        path: ".env",
        old_string: "x",
        new_string: "y",
      },
      { sensitive: true },
    );
    expect(result).toContain('path: ".env"');
    expect(result).toContain("old_string: [...]");
    expect(result).toContain("new_string: [...]");
    expect(result).not.toContain('"x"');
    expect(result).not.toContain('"y"');
  });

  it("sensitive flag redacts short content too", () => {
    const result = formatToolInputSummary(
      { path: ".env", content: "short" },
      { sensitive: true },
    );
    expect(result).toContain("content: [...]");
    expect(result).not.toContain("short");
  });
});
