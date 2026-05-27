import { describe, expect, it } from "vitest";
import {
  AiSdkProvider,
  mapStreamPartToModelEvent,
} from "../src/model/ai-sdk-provider.js";
import {
  convertMessages,
  convertMessagesToUI,
  conversationSummarySystemPrompt,
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
      { id: "user-0", role: "user", parts: [{ type: "text", text: "read file" }] },
      {
        id: "assistant-1",
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

  it("moves summary messages into the system prompt instead of messages", () => {
    expect(
      conversationSummarySystemPrompt([
        { role: "summary", content: "Already inspected package.json." },
        { role: "user", content: "continue" },
      ]),
    ).toBe(
      "<conversation_summary>\nAlready inspected package.json.\n</conversation_summary>",
    );
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

  it("defaults official OpenAI to Responses mode", () => {
    const provider = new AiSdkProvider({
      provider: "openai",
      model: "gpt-5",
      apiKey: "sk-test",
    });

    expect(provider.name).toBe("openai");
    expect(provider.mode).toBe("responses");
  });

  it("defaults custom OpenAI-compatible base URLs to Chat Completions", () => {
    const provider = new AiSdkProvider({
      provider: "openai",
      model: "mimo-v2.5-pro",
      apiKey: "sk-test",
      baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
    });

    expect(provider.name).toBe("openai");
    expect(provider.mode).toBe("chat");
  });

  it("uses the OpenAI-compatible SDK adapter in chat mode", () => {
    const provider = new AiSdkProvider({
      provider: "openai",
      adapter: "@ai-sdk/openai-compatible",
      model: "mimo-v2.5-pro",
      apiKey: "sk-test",
      baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
      mode: "responses",
    });

    expect(provider.name).toBe("openai");
    expect(provider.adapter).toBe("@ai-sdk/openai-compatible");
    expect(provider.mode).toBe("chat");
  });

  it("uses Anthropic Messages mode", () => {
    const provider = new AiSdkProvider({
      provider: "anthropic",
      model: "claude-test",
      apiKey: "sk-test",
    });

    expect(provider.name).toBe("anthropic");
    expect(provider.mode).toBe("messages");
  });

  it("keeps Anthropic prompt history free of empty text and reasoning parts", async () => {
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
            { type: "text", text: "final" },
          ],
        },
      ],
    });

    expect(result).toEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "final" }],
      },
    ]);
  });

  it("builds OpenAI Responses continuation options", () => {
    expect(
      providerOptions({
        config: {
          provider: "openai",
          model: "gpt-5",
          options: {
            store: false,
            reasoningEffort: "high",
            reasoningSummary: "auto",
            textVerbosity: "medium",
            systemMessageMode: "developer",
            apiKey: "sk-ignored",
          },
        },
        mode: "responses",
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
        store: false,
        reasoningEffort: "high",
        reasoningSummary: "auto",
        textVerbosity: "medium",
        systemMessageMode: "developer",
        previousResponseId: "resp_1",
      },
    });
  });

  it("does not send Responses-only provider options in chat mode", () => {
    expect(
      providerOptions({
        config: {
          provider: "openai",
          model: "mimo-v2.5-pro",
          options: {
            store: false,
            reasoningEffort: "high",
            reasoningSummary: "auto",
            textVerbosity: "high",
            systemMessageMode: "developer",
          },
        },
        mode: "chat",
        messages: [],
      }),
    ).toEqual({});
  });

  it("maps AI SDK stream boundaries into model events", () => {
    expect(mapStreamPartToModelEvent({ type: "start" }, "openai")).toEqual({
      type: "start",
    });
    expect(
      mapStreamPartToModelEvent(
        {
          type: "text-start",
          id: "txt_1",
          providerMetadata: { openai: { itemId: "msg_1" } },
        },
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
