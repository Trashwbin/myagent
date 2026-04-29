import { describe, it, expect } from "vitest";
import { convertMessages } from "../src/model/anthropic-compatible.js";

describe("Anthropic convertMessages", () => {
  it("converts user message", () => {
    const result = convertMessages([{ role: "user", content: "hello" }]);
    expect(result).toEqual([{ role: "user", content: "hello" }]);
  });

  it("converts assistant text-only message", () => {
    const result = convertMessages([{ role: "assistant", content: "hi" }]);
    expect(result).toEqual([
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ]);
  });

  it("converts assistant message with tool calls", () => {
    const result = convertMessages([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tu1", name: "read_file", input: { path: "a.txt" } }],
      },
    ]);
    expect(result[0]).toMatchObject({
      role: "assistant",
      content: [{ type: "tool_use", id: "tu1", name: "read_file" }],
    });
  });

  it("converts assistant message with both text and tool calls", () => {
    const result = convertMessages([
      {
        role: "assistant",
        content: "Let me check.",
        toolCalls: [{ id: "tu1", name: "bash", input: { command: "ls" } }],
      },
    ]);
    expect(result[0]).toMatchObject({
      role: "assistant",
      content: [
        { type: "text", text: "Let me check." },
        { type: "tool_use", id: "tu1", name: "bash" },
      ],
    });
  });

  it("converts tool_result to user message with tool_result block", () => {
    const result = convertMessages([
      {
        role: "tool_result",
        content: "file contents",
        toolCallId: "tu1",
        toolName: "read_file",
      },
    ]);
    expect(result).toEqual([
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tu1", content: "file contents" }],
      },
    ]);
  });

  it("merges consecutive tool_results into one user message", () => {
    const result = convertMessages([
      {
        role: "tool_result",
        content: "file a",
        toolCallId: "tu1",
        toolName: "read_file",
      },
      {
        role: "tool_result",
        content: "file b",
        toolCallId: "tu2",
        toolName: "read_file",
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toHaveLength(2);
  });

  it("converts a full multi-turn conversation", () => {
    const result = convertMessages([
      { role: "user", content: "read package.json and run tests" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tu1", name: "read_file", input: { path: "package.json" } }],
      },
      {
        role: "tool_result",
        content: '{ "name": "myagent" }',
        toolCallId: "tu1",
        toolName: "read_file",
      },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tu2", name: "bash", input: { command: "pnpm test" } }],
      },
      {
        role: "tool_result",
        content: "all tests passed",
        toolCallId: "tu2",
        toolName: "bash",
      },
      { role: "assistant", content: "Done! All tests pass." },
    ]);

    // user, assistant, user(tool_result), assistant, user(tool_result), assistant
    expect(result).toHaveLength(6);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
    expect(result[2].role).toBe("user");
    expect(result[3].role).toBe("assistant");
    expect(result[4].role).toBe("user");
    expect(result[5].role).toBe("assistant");
  });
});
