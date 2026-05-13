import { describe, expect, it, afterEach } from "vitest";
import {
  convertMessages,
  OpenAIResponsesProvider,
} from "../src/model/openai-responses.js";
import type { ModelEvent } from "../src/model/types.js";

async function collectEvents(stream: AsyncGenerator<ModelEvent>): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("OpenAI Responses convertMessages", () => {
  it("converts user, assistant tool call, and tool result messages", () => {
    const result = convertMessages(
      [
        { role: "user", content: "list files" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", name: "list_dir", input: { path: "." } }],
        },
        {
          role: "tool_result",
          toolCallId: "call_1",
          toolName: "list_dir",
          content: "package.json\nsrc\n",
        },
      ],
      "system prompt",
    );

    expect(result).toEqual([
      { role: "system", content: "system prompt" },
      { role: "user", content: [{ type: "input_text", text: "list files" }] },
      {
        type: "function_call",
        call_id: "call_1",
        name: "list_dir",
        arguments: '{"path":"."}',
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: "package.json\nsrc\n",
      },
    ]);
  });

  it("converts persisted canonical tool-call parts", () => {
    const result = convertMessages([
      {
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-call",
            id: "call_1",
            name: "list_dir",
            input: { path: "." },
            providerMetadata: { openai: { itemId: "item_1" } },
          },
        ],
      },
    ]);

    expect(result).toEqual([
      {
        type: "function_call",
        call_id: "call_1",
        name: "list_dir",
        arguments: '{"path":"."}',
      },
    ]);
  });
});

describe("OpenAIResponsesProvider", () => {
  it("parses non-SSE JSON body returned with event-stream content type", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          id: "resp_1",
          object: "response",
          status: "completed",
          output: [
            {
              type: "reasoning",
              id: "item_reasoning",
              summary: [{ type: "summary_text", text: "Need list" }],
            },
            {
              type: "function_call",
              id: "item_call",
              call_id: "call_1",
              name: "list_dir",
              arguments: '{}{"path":"."}',
            },
          ],
          usage: {
            input_tokens: 10,
            output_tokens: 4,
            total_tokens: 14,
            output_tokens_details: { reasoning_tokens: 2 },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        },
      );

    const provider = new OpenAIResponsesProvider({
      provider: "openai",
      protocol: "responses",
      model: "test-model",
      apiKey: "sk-test",
      baseUrl: "https://example.test/v1",
    });

    const events = await collectEvents(
      provider.stream([{ role: "user", content: "list" }], [
        {
          name: "list_dir",
          description: "List directory",
          parameters: { type: "object" },
        },
      ]),
    );

    expect(events).toEqual([
      {
        type: "reasoning",
        id: "item_reasoning",
        delta: "Need list",
        providerMetadata: {
          openai: {
            itemId: "item_reasoning",
            item: {
              type: "reasoning",
              id: "item_reasoning",
              summary: [{ type: "summary_text", text: "Need list" }],
            },
          },
        },
      },
      {
        type: "tool-call",
        id: "call_1",
        name: "list_dir",
        input: { path: "." },
        providerMetadata: {
          openai: { itemId: "item_call", callId: "call_1" },
        },
      },
      {
        type: "finish",
        reason: "tool-calls",
        usage: {
          inputTokens: 10,
          outputTokens: 4,
          totalTokens: 14,
          reasoningTokens: 2,
          providerMetadata: {
            openai: {
              input_tokens: 10,
              output_tokens: 4,
              total_tokens: 14,
              output_tokens_details: { reasoning_tokens: 2 },
            },
          },
        },
        providerMetadata: {
          openai: { responseId: "resp_1", status: undefined },
        },
      },
    ]);
  });

  it("parses streaming response events", async () => {
    globalThis.fetch = async () =>
      new Response(
        [
          'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","item_id":"text_1","delta":"hi"}',
          'event: response.output_item.done\ndata: {"type":"response.output_item.done","item":{"type":"function_call","id":"item_1","call_id":"call_1","name":"list_dir","arguments":"{\\"path\\":\\".\\"}"}}',
          'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_1","status":"completed"}}',
          "",
        ].join("\n\n"),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );

    const provider = new OpenAIResponsesProvider({
      provider: "openai",
      protocol: "responses",
      model: "test-model",
      apiKey: "sk-test",
      baseUrl: "https://example.test/v1",
    });

    const events = await collectEvents(provider.stream([{ role: "user", content: "hello" }]));

    expect(events).toEqual([
      { type: "text", id: "text_1", delta: "hi" },
      {
        type: "tool-call",
        id: "call_1",
        name: "list_dir",
        input: { path: "." },
        providerMetadata: {
          openai: { itemId: "item_1", callId: "call_1" },
        },
      },
      {
        type: "finish",
        reason: "tool-calls",
        usage: undefined,
        providerMetadata: {
          openai: { responseId: "resp_1", status: "completed" },
        },
      },
    ]);
  });
});
