import { describe, expect, it } from "vitest";
import { AiSdkProvider, convertMessages } from "../src/model/ai-sdk-provider.js";

describe("AI SDK provider adapter", () => {
  it("converts transcript messages into AI SDK model messages", () => {
    const messages = convertMessages([
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
        role: "system",
        content:
          "<conversation_summary>\nAlready inspected package.json.\n</conversation_summary>",
      },
      { role: "user", content: "read file" },
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "Need file contents.",
            providerOptions: { openai: { itemId: "reasoning_1" } },
          },
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "Read",
            input: { path: "package.json" },
            providerOptions: { openai: { itemId: "item_1" } },
          },
        ],
        providerOptions: { openai: { responseId: "resp_1" } },
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
});
