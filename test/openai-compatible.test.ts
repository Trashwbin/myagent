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

  it("converts summary message to system context", () => {
    const result = convertMessages([
      { role: "summary", content: "User already edited auth.ts." },
    ]);
    expect(result).toEqual([
      {
        role: "system",
        content:
          "<conversation_summary>\nUser already edited auth.ts.\n</conversation_summary>",
      },
    ]);
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
        toolCalls: [{ id: "tc1", name: "Read", input: { path: "a.txt" } }],
      },
    ]);
    expect(result[0]).toMatchObject({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "tc1",
          type: "function",
          function: { name: "Read", arguments: '{"path":"a.txt"}' },
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
        toolName: "Read",
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
        toolCalls: [{ id: "tc1", name: "Read", input: { path: "package.json" } }],
      },
      {
        role: "tool_result",
        content: '{ "name": "myagent" }',
        toolCallId: "tc1",
        toolName: "Read",
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
                          function: { name: "Re", arguments: "" },
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
                          function: { name: "ad", arguments: '{"path"' },
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
        name: "Read",
        input: { path: "package.json" },
      },
      { type: "stop", reason: "tool_use" },
    ]);
  });

  it("sends system prompt as first OpenAI message", async () => {
    const provider = new OpenAICompatibleProvider({
      provider: "openai",
      model: "test-model",
      apiKey: "test-key",
    });
    let capturedParams: any;

    (provider as any).client = {
      chat: {
        completions: {
          create: async (params: any) => {
            capturedParams = params;
            return chunks([
              {
                choices: [{ delta: {}, finish_reason: "stop" }],
              },
            ]);
          },
        },
      },
    };

    await collectEvents(
      provider.stream([{ role: "user", content: "hello" }], undefined, {
        systemPrompt: "system rules",
      }),
    );

    expect(capturedParams.messages[0]).toEqual({
      role: "system",
      content: "system rules",
    });
    expect(capturedParams.messages[1]).toEqual({ role: "user", content: "hello" });
  });

  it("does not send max_tokens when maxOutputTokens is unset", async () => {
    const provider = new OpenAICompatibleProvider({
      provider: "openai",
      model: "test-model",
      apiKey: "test-key",
    });
    let capturedParams: any;

    (provider as any).client = {
      chat: {
        completions: {
          create: async (params: any) => {
            capturedParams = params;
            return chunks([
              {
                choices: [{ delta: {}, finish_reason: "stop" }],
              },
            ]);
          },
        },
      },
    };

    await collectEvents(provider.stream([{ role: "user", content: "hello" }]));

    expect("max_tokens" in capturedParams).toBe(false);
  });

  it("sends max_tokens when maxOutputTokens is configured", async () => {
    const provider = new OpenAICompatibleProvider({
      provider: "openai",
      model: "test-model",
      apiKey: "test-key",
      maxOutputTokens: 2048,
    });
    let capturedParams: any;

    (provider as any).client = {
      chat: {
        completions: {
          create: async (params: any) => {
            capturedParams = params;
            return chunks([
              {
                choices: [{ delta: {}, finish_reason: "stop" }],
              },
            ]);
          },
        },
      },
    };

    await collectEvents(provider.stream([{ role: "user", content: "hello" }]));

    expect(capturedParams.max_tokens).toBe(2048);
  });
});
