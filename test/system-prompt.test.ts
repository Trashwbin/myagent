import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/session/system-prompt.js";

describe("system prompt", () => {
  it("contains workspace and tool boundary instructions", () => {
    const prompt = buildSystemPrompt("/tmp/workspace");

    expect(prompt).toContain("You are myagent");
    expect(prompt).toContain("The workspace root is: /tmp/workspace");
    expect(prompt).toContain("Use Read for file content inspection");
    expect(prompt).toContain("offset/limit");
    expect(prompt).toContain("Use grep to search file contents");
    expect(prompt).toContain("Use glob to find files by name pattern");
    expect(prompt).toContain("find_up to locate the nearest config file");
    expect(prompt).toContain("edit_file");
    expect(prompt).toContain("write_file");
    expect(prompt).toContain("apply_patch");
    expect(prompt).toContain("git diff --stat");
    expect(prompt).toContain("Do not use bash for `cat`, `ls`, `rg`, or `grep`");
    expect(prompt).toContain("cat > file");
    expect(prompt).toContain("do not claim it succeeded");
    expect(prompt).toContain("checkpoint id");
  });

  it("contains recommended workflow", () => {
    const prompt = buildSystemPrompt("/tmp/workspace");

    expect(prompt).toContain("glob — find relevant files");
    expect(prompt).toContain("grep — locate specific content");
    expect(prompt).toContain("Read — read targeted sections");
  });

  it("contains mutation failure recovery discipline", () => {
    const prompt = buildSystemPrompt("/tmp/workspace");

    expect(prompt).toContain("recovery step");
    expect(prompt).toContain("retry the mutation");
    expect(prompt).toContain("Do not treat the read as task completion");
  });
});
