import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/session/system-prompt.js";
import { readFileTool } from "../src/tools/read.js";
import { bashTool } from "../src/tools/bash.js";
import { searchTool } from "../src/tools/search.js";
import { globTool } from "../src/tools/glob.js";
import { findUpTool } from "../src/tools/find-up.js";
import { applyPatchTool } from "../src/tools/apply-patch.js";

describe("system prompt", () => {
  it("contains identity and workspace root", () => {
    const prompt = buildSystemPrompt("/tmp/workspace");

    expect(prompt).toContain("You are myagent");
    expect(prompt).toContain("The workspace root is: /tmp/workspace");
  });

  it("contains global tool discipline", () => {
    const prompt = buildSystemPrompt("/tmp/workspace");

    expect(prompt).toContain("Prefer dedicated tools over bash for file exploration");
    expect(prompt).toContain("filesystem primitives");
    expect(prompt).toContain("cat > file");
    expect(prompt).toContain("Do not use bash for `cat`, `ls`, `rg`, or `grep`");
    expect(prompt).toContain("Always Read before write_file on existing files");
  });

  it("contains approval and safety discipline", () => {
    const prompt = buildSystemPrompt("/tmp/workspace");

    expect(prompt).toContain("do not claim it succeeded");
  });

  it("contains mutation recovery discipline", () => {
    const prompt = buildSystemPrompt("/tmp/workspace");

    expect(prompt).toContain("gather updated context");
    expect(prompt).toContain("continue the modification");
    expect(prompt).toContain("explain why you cannot continue");
    expect(prompt).not.toContain("checkpoint id");
  });

  it("does not contain tool-specific usage details", () => {
    const prompt = buildSystemPrompt("/tmp/workspace");

    expect(prompt).not.toContain("offset/limit");
    expect(prompt).not.toContain("git diff --stat");
    expect(prompt).not.toContain("glob — find relevant files");
    expect(prompt).not.toContain("grep — locate specific content");
    expect(prompt).not.toContain("Read — read targeted sections");
  });
});

describe("tool descriptions", () => {
  it("Read describes grep-then-read guidance and offset/limit", () => {
    const desc = readFileTool.description;
    expect(desc).toContain("grep to locate content first");
    expect(desc).toContain("offset");
    expect(desc).toContain("2000 lines");
    expect(desc).toContain("line numbers");
  });

  it("bash describes execution role and dedicated tool alternatives", () => {
    const desc = bashTool.description;
    expect(desc).toContain("git operations");
    expect(desc).toContain("filesystem primitives");
    expect(desc).toContain("glob for file discovery");
    expect(desc).toContain("grep for content search");
  });

  it("grep clarifies content search vs file discovery", () => {
    const desc = searchTool.description;
    expect(desc).toContain("Search for a pattern in file contents");
    expect(desc).toContain("Use glob for file discovery, not grep");
    expect(desc).toContain("before_context/after_context");
  });

  it("glob describes file discovery role", () => {
    const desc = globTool.description;
    expect(desc).toContain("Find files by name pattern");
    expect(desc).toContain("hidden files");
    expect(desc).toContain("file discovery tool");
  });

  it("find_up describes ancestor config lookup", () => {
    const desc = findUpTool.description;
    expect(desc).toContain("walking up the directory tree");
    expect(desc).toContain("package.json");
    expect(desc).toContain("tsconfig.json");
  });

  it("apply_patch describes patch grammar and recovery", () => {
    const desc = applyPatchTool.description;
    expect(desc).toContain("Begin Patch");
    expect(desc).toContain("Add File");
    expect(desc).toContain("Update File");
    expect(desc).toContain("Delete File");
    expect(desc).toContain("Preflight validation");
    expect(desc).toContain("gather updated context");
  });
});
