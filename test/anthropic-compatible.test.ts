import { describe, it, expect } from "vitest";
import {
  AnthropicCompatibleProvider,
  convertMessages,
} from "../src/model/anthropic-compatible.js";

async function* chunks(items: unknown[]) {
  yield* items;
}

async function collectEvents(stream: AsyncGenerator<unknown>): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("Anthropic convertMessages", () => {
  it("converts user message", () => {
    const result = convertMessages([{ role: "user", content: "hello" }]);
    expect(result).toEqual([{ role: "user", content: "hello" }]);
  });

  it("converts summary message to user context", () => {
    const result = convertMessages([
      { role: "summary", content: "User already edited auth.ts." },
    ]);
    expect(result).toEqual([
      {
        role: "user",
        content:
          "<conversation_summary>\nUser already edited auth.ts.\n</conversation_summary>",
      },
    ]);
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
        toolCalls: [{ id: "tu1", name: "Read", input: { path: "a.txt" } }],
      },
    ]);
    expect(result[0]).toMatchObject({
      role: "assistant",
      content: [{ type: "tool_use", id: "tu1", name: "Read" }],
    });
  });

  it("uses provider raw assistant blocks when present", () => {
    const providerRaw = [
      { type: "thinking", thinking: "need list", signature: "sig" },
      {
        type: "tool_use",
        id: "tu1",
        name: "list_dir",
        input: { path: "." },
      },
    ];
    const result = convertMessages([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tu1", name: "list_dir", input: { path: "." } }],
        providerRaw,
      },
    ]);

    expect(result).toEqual([{ role: "assistant", content: providerRaw }]);
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
        toolName: "Read",
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
        toolName: "Read",
      },
      {
        role: "tool_result",
        content: "file b",
        toolCallId: "tu2",
        toolName: "Read",
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
        toolCalls: [{ id: "tu1", name: "Read", input: { path: "package.json" } }],
      },
      {
        role: "tool_result",
        content: '{ "name": "myagent" }',
        toolCallId: "tu1",
        toolName: "Read",
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

  it("sends system prompt in Anthropic message params", async () => {
    const provider = new AnthropicCompatibleProvider({
      provider: "anthropic",
      model: "test-model",
      apiKey: "test-key",
    });
    let capturedParams: any;

    (provider as any).client = {
      messages: {
        stream: (params: any) => {
          capturedParams = params;
          return chunks([
            {
              type: "message_delta",
              delta: { stop_reason: "end_turn" },
            },
          ]);
        },
      },
    };

    await collectEvents(
      provider.stream([{ role: "user", content: "hello" }], undefined, {
        systemPrompt: "system rules",
      }),
    );

    expect(capturedParams.system).toBe("system rules");
    expect(capturedParams.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("uses 16384 as the default max_tokens when maxOutputTokens is unset", async () => {
    const provider = new AnthropicCompatibleProvider({
      provider: "anthropic",
      model: "test-model",
      apiKey: "test-key",
    });
    let capturedParams: any;

    (provider as any).client = {
      messages: {
        stream: (params: any) => {
          capturedParams = params;
          return chunks([
            {
              type: "message_delta",
              delta: { stop_reason: "end_turn" },
            },
          ]);
        },
      },
    };

    await collectEvents(provider.stream([{ role: "user", content: "hello" }]));

    expect(capturedParams.max_tokens).toBe(16384);
  });

  it("uses configured maxOutputTokens when provided", async () => {
    const provider = new AnthropicCompatibleProvider({
      provider: "anthropic",
      model: "test-model",
      apiKey: "test-key",
      maxOutputTokens: 4096,
    });
    let capturedParams: any;

    (provider as any).client = {
      messages: {
        stream: (params: any) => {
          capturedParams = params;
          return chunks([
            {
              type: "message_delta",
              delta: { stop_reason: "end_turn" },
            },
          ]);
        },
      },
    };

    await collectEvents(provider.stream([{ role: "user", content: "hello" }]));

    expect(capturedParams.max_tokens).toBe(4096);
  });

  it("emits raw assistant blocks with thinking before stop", async () => {
    const provider = new AnthropicCompatibleProvider({
      provider: "anthropic",
      model: "test-model",
      apiKey: "test-key",
    });

    (provider as any).client = {
      messages: {
        stream: () =>
          chunks([
            {
              type: "content_block_start",
              index: 0,
              content_block: { type: "thinking", thinking: "", signature: "" },
            },
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "thinking_delta", thinking: "need list" },
            },
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "signature_delta", signature: "sig" },
            },
            { type: "content_block_stop", index: 0 },
            {
              type: "content_block_start",
              index: 1,
              content_block: {
                type: "tool_use",
                id: "tu1",
                name: "list_dir",
                input: {},
              },
            },
            {
              type: "content_block_delta",
              index: 1,
              delta: { type: "input_json_delta", partial_json: '{"path":"."}' },
            },
            { type: "content_block_stop", index: 1 },
            {
              type: "message_delta",
              delta: { stop_reason: "tool_use" },
            },
          ]),
      },
    };

    const events = await collectEvents(provider.stream([{ role: "user", content: "list" }]));

    expect(events).toEqual([
      { type: "tool_call", id: "tu1", name: "list_dir", input: { path: "." } },
      {
        type: "assistant_raw",
        value: [
          { type: "thinking", thinking: "need list", signature: "sig" },
          {
            type: "tool_use",
            id: "tu1",
            name: "list_dir",
            input: { path: "." },
          },
        ],
      },
      { type: "stop", reason: "tool_use" },
    ]);
  });
});
