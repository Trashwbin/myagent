import { describe, expect, it } from "vitest";
import { truncateOutput } from "../src/tools/bash.js";

describe("bash output budget", () => {
  it("passes through output under byte limit", () => {
    const output = "a".repeat(100);
    expect(truncateOutput(output)).toBe(output);
  });

  it("truncates output exceeding byte limit", () => {
    const output = "a".repeat(25_000);
    const result = truncateOutput(output);
    expect(result).toContain("output truncated");
    expect(result).toContain("showing first");
    expect(result.length).toBeLessThan(25_000);
  });

  it("truncates output exceeding line limit", () => {
    const lines = Array.from({ length: 600 }, (_, i) => `line ${i}`);
    const output = lines.join("\n");
    const result = truncateOutput(output);
    expect(result).toContain("output truncated");
    const resultLines = result.split("\n");
    expect(resultLines.length).toBeLessThan(600);
  });

  it("preserves short output exactly", () => {
    const output = "hello world\nline 2\nline 3";
    expect(truncateOutput(output)).toBe(output);
  });

  it("truncation message suggests alternatives", () => {
    const output = "a".repeat(25_000);
    const result = truncateOutput(output);
    expect(result).toContain("output truncated");
    expect(result).toContain("narrower command");
    expect(result).toContain("--stat");
    expect(result).toContain("head/tail");
  });
});
