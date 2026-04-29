import { describe, it, expect } from "vitest";
import {
  convertMessages,
  OpenAICompatibleProvider,
} from "../src/model/openai-compatible.js";
import type { ModelEvent } from "../src/model/types.js";

async function* chunks(items: unknown[]) {
  yield* items;
}

async function collectEvents(stream: AsyncGenerator<ModelEvent>): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("OpenAI convertMessages", () => {
  it("converts user message", () => {
    const result = convertMessages([{ role: "user", content: "hello" }]);
    expect(result).toEqual([{ role: "user", content: "hello" }]);
  });

  it("converts assistant message with text only", () => {
    const result = convertMessages([{ role: "assistant", content: "hi there" }]);
    expect(result).toEqual([{ role: "assistant", content: "hi there" }]);
  });

  it("converts assistant message with tool calls", () => {
    const result = convertMessages([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tc1", name: "read_file", input: { path: "a.txt" } }],
      },
    ]);
    expect(result[0]).toMatchObject({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "tc1",
          type: "function",
          function: { name: "read_file", arguments: '{"path":"a.txt"}' },
        },
      ],
    });
  });

  it("converts assistant message with null content when empty", () => {
    const result = convertMessages([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tc1", name: "bash", input: { command: "echo hi" } }],
      },
    ]);
    expect(result[0]).toMatchObject({ role: "assistant", content: null });
  });

  it("converts tool_result message", () => {
    const result = convertMessages([
      {
        role: "tool_result",
        content: "file contents",
        toolCallId: "tc1",
        toolName: "read_file",
      },
    ]);
    expect(result).toEqual([
      { role: "tool", tool_call_id: "tc1", content: "file contents" },
    ]);
  });

  it("converts a full conversation round-trip", () => {
    const result = convertMessages([
      { role: "user", content: "read package.json" },
      {
        role: "assistant",
        content: "Let me read that file.",
        toolCalls: [{ id: "tc1", name: "read_file", input: { path: "package.json" } }],
      },
      {
        role: "tool_result",
        content: '{ "name": "myagent" }',
        toolCallId: "tc1",
        toolName: "read_file",
      },
    ]);

    expect(result).toHaveLength(3);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
    expect(result[2].role).toBe("tool");
    expect((result[2] as any).tool_call_id).toBe("tc1");
  });

  it("stringifies non-string tool input", () => {
    const result = convertMessages([
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tc1",
            name: "edit_file",
            input: { path: "a.ts", old_string: "x", new_string: "y" },
          },
        ],
      },
    ]);
    const args = (result[0] as any).tool_calls[0].function.arguments;
    expect(JSON.parse(args)).toEqual({
      path: "a.ts",
      old_string: "x",
      new_string: "y",
    });
  });

  it("streams tool call name and arguments across chunks", async () => {
    const provider = new OpenAICompatibleProvider({
      provider: "openai",
      model: "test-model",
      apiKey: "test-key",
    });

    (provider as any).client = {
      chat: {
        completions: {
          create: async () =>
            chunks([
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "call_1",
                          function: { name: "read_" },
                        },
                      ],
                    },
                  },
                ],
              },
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          function: { name: "file", arguments: '{"path"' },
                        },
                      ],
                    },
                  },
                ],
              },
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          function: { arguments: ':"package.json"}' },
                        },
                      ],
                    },
                    finish_reason: "tool_calls",
                  },
                ],
              },
            ]),
        },
      },
    };

    const events = await collectEvents(provider.stream([]));

    expect(events).toEqual([
      {
        type: "tool_call",
        id: "call_1",
        name: "read_file",
        input: { path: "package.json" },
      },
      { type: "stop", reason: "tool_use" },
    ]);
  });
});
