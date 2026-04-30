import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/session/system-prompt.js";

describe("system prompt", () => {
  it("contains workspace and tool boundary instructions", () => {
    const prompt = buildSystemPrompt("/tmp/workspace");

    expect(prompt).toContain("You are myagent");
    expect(prompt).toContain("The workspace root is: /tmp/workspace");
    expect(prompt).toContain("Modify existing files only with edit_file");
    expect(prompt).toContain("Do not use bash to create, edit, delete");
    expect(prompt).toContain("do not claim it succeeded");
    expect(prompt).toContain("checkpoint id");
  });
});
