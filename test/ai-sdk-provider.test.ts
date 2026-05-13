import { describe, expect, it } from "vitest";
import { AiSdkProvider, mapStreamPartToModelEvent } from "../src/model/ai-sdk-provider.js";
import {
  convertMessages,
  convertMessagesToUI,
  messages,
  providerOptions,
} from "../src/model/provider-transform.js";

describe("AI SDK provider adapter", () => {
  it("converts structured transcript parts into AI SDK UI messages", () => {
    const messages = convertMessagesToUI([
      { role: "summary", content: "Already inspected package.json." },
      { role: "user", content: "read file" },
      {
        role: "assistant",
        content: "",
        parts: [
          {
            type: "reasoning",
            text: "Need file contents.",
            providerMetadata: { openai: { itemId: "reasoning_1" } },
          },
          {
            type: "tool-call",
            id: "call_1",
            name: "Read",
            input: { path: "package.json" },
            providerMetadata: { openai: { itemId: "item_1" } },
          },
        ],
        providerMetadata: { openai: { responseId: "resp_1" } },
      },
      {
        role: "tool_result",
        toolCallId: "call_1",
        toolName: "Read",
        content: "hello",
        providerMetadata: { openai: { itemId: "item_1" } },
      },
    ]);

    expect(messages).toEqual([
      {
        id: "summary-0",
        role: "system",
        parts: [
          {
            type: "text",
            text:
              "<conversation_summary>\nAlready inspected package.json.\n</conversation_summary>",
          },
        ],
      },
      { id: "user-1", role: "user", parts: [{ type: "text", text: "read file" }] },
      {
        id: "assistant-2",
        role: "assistant",
        parts: [
          {
            type: "reasoning",
            text: "Need file contents.",
            providerMetadata: { openai: { itemId: "reasoning_1" } },
          },
          {
            type: "tool-Read",
            toolCallId: "call_1",
            state: "output-available",
            input: { path: "package.json" },
            output: "hello",
            callProviderMetadata: { openai: { itemId: "item_1" } },
            resultProviderMetadata: { openai: { itemId: "item_1" } },
          },
        ],
        metadata: { openai: { responseId: "resp_1" } },
      },
    ]);
  });

  it("uses AI SDK convertToModelMessages for final model messages", async () => {
    const messages = await convertMessages([
      { role: "user", content: "read file" },
      {
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-call",
            id: "call_1",
            name: "Read",
            input: { path: "package.json" },
            providerMetadata: { openai: { itemId: "item_1" } },
          },
        ],
      },
      {
        role: "tool_result",
        toolCallId: "call_1",
        toolName: "Read",
        content: "hello",
        providerMetadata: { openai: { itemId: "item_1" } },
      },
    ]);

    expect(messages).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "read file" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "Read",
            input: { path: "package.json" },
            providerOptions: { openai: { itemId: "item_1" } },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "Read",
            output: { type: "text", value: "hello" },
            providerOptions: { openai: { itemId: "item_1" } },
          },
        ],
      },
    ]);
  });

  it("defaults OpenAI to the Responses protocol", () => {
    const provider = new AiSdkProvider({
      provider: "openai",
      model: "gpt-5",
      apiKey: "sk-test",
    });

    expect(provider.name).toBe("openai");
    expect(provider.protocol).toBe("responses");
  });

  it("uses Anthropic Messages protocol", () => {
    const provider = new AiSdkProvider({
      provider: "anthropic",
      model: "claude-test",
      apiKey: "sk-test",
    });

    expect(provider.name).toBe("anthropic");
    expect(provider.protocol).toBe("messages");
  });

  it("keeps Anthropic prompt history free of empty text parts", async () => {
    const result = await messages({
      config: { provider: "anthropic", model: "claude-test" },
      messages: [
        { role: "user", content: "" },
        {
          role: "assistant",
          content: "",
          parts: [
            { type: "text", text: "" },
            { type: "reasoning", text: "thinking" },
          ],
        },
      ],
    });

    expect(result).toEqual([
      {
        role: "assistant",
        content: [{ type: "reasoning", text: "thinking" }],
      },
    ]);
  });

  it("builds OpenAI Responses continuation options", () => {
    expect(
      providerOptions({
        config: { provider: "openai", model: "gpt-5" },
        protocol: "responses",
        messages: [
          {
            role: "assistant",
            content: "done",
            providerMetadata: { openai: { responseId: "resp_1" } },
          },
        ],
      }),
    ).toEqual({
      openai: {
        store: true,
        previousResponseId: "resp_1",
      },
    });
  });

  it("maps AI SDK stream boundaries into model events", () => {
    expect(mapStreamPartToModelEvent({ type: "start" }, "openai")).toEqual({
      type: "start",
    });
    expect(
      mapStreamPartToModelEvent(
        { type: "text-start", id: "txt_1", providerMetadata: { openai: { itemId: "msg_1" } } },
        "openai",
      ),
    ).toEqual({
      type: "text-start",
      id: "txt_1",
      providerMetadata: { openai: { itemId: "msg_1" } },
    });
    expect(
      mapStreamPartToModelEvent(
        {
          type: "finish-step",
          finishReason: "tool-calls",
          rawFinishReason: "tool_calls",
          usage: {
            inputTokens: 10,
            inputTokenDetails: {
              cacheReadTokens: undefined,
              cacheWriteTokens: undefined,
              noCacheTokens: undefined,
            },
            outputTokens: 2,
            outputTokenDetails: { reasoningTokens: 1, textTokens: 1 },
            totalTokens: 12,
          },
          response: {
            id: "resp_1",
            timestamp: new Date("2026-05-13T00:00:00.000Z"),
            modelId: "gpt-test",
          },
          providerMetadata: { openai: { responseId: "resp_1" } },
        },
        "openai",
      ),
    ).toMatchObject({
      type: "step-finish",
      reason: "tool-calls",
      usage: {
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
        reasoningTokens: 1,
      },
      providerMetadata: { openai: { responseId: "resp_1" } },
    });
  });
});
