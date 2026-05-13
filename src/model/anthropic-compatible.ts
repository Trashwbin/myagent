import Anthropic from "@anthropic-ai/sdk";
import type { Provider } from "./provider.js";
import type { ProviderStreamOptions } from "./provider.js";
import type { ModelEvent, Message, ProviderConfig, ToolSchema } from "./types.js";
import { normalizeProviderError, ProviderRuntimeError } from "./errors.js";

type FinishReason = "stop" | "tool-calls" | "length";

const CANONICAL_STOP_REASON_MAP: Record<string, FinishReason> = {
  end_turn: "stop",
  tool_use: "tool-calls",
  max_tokens: "length",
  stop_sequence: "stop",
};

export function convertMessages(messages: Message[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    switch (msg.role) {
      case "user":
        result.push({ role: "user", content: msg.content });
        i++;
        break;

      case "summary":
        result.push({
          role: "user",
          content: `<conversation_summary>\n${msg.content}\n</conversation_summary>`,
        });
        i++;
        break;

      case "assistant": {
        if (isAnthropicContentBlocks(msg.providerRaw)) {
          result.push({ role: "assistant", content: msg.providerRaw });
          i++;
          break;
        }

        const content: Anthropic.ContentBlockParam[] = [];
        if (msg.content) {
          content.push({ type: "text", text: msg.content });
        }
        if (msg.toolCalls?.length) {
          for (const tc of msg.toolCalls) {
            content.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: tc.input as Record<string, unknown>,
            });
          }
        }
        result.push({ role: "assistant", content });
        i++;
        break;
      }

      case "tool_result": {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        while (i < messages.length && messages[i].role === "tool_result") {
          const tr = messages[i];
          toolResults.push({
            type: "tool_result",
            tool_use_id: tr.toolCallId ?? "",
            content: tr.content,
          });
          i++;
        }
        result.push({ role: "user", content: toolResults });
        break;
      }
    }
  }

  return result;
}

function isAnthropicContentBlocks(value: unknown): value is Anthropic.ContentBlockParam[] {
  return Array.isArray(value) && value.every((block) => {
    if (typeof block !== "object" || block === null) return false;
    const type = (block as { type?: unknown }).type;
    return (
      type === "text" ||
      type === "thinking" ||
      type === "tool_use" ||
      type === "redacted_thinking"
    );
  });
}

function convertTools(tools?: ToolSchema[]): Anthropic.Tool[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool.InputSchema,
  }));
}

export class AnthropicCompatibleProvider implements Provider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(private config: ProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.authToken ? undefined : config.apiKey,
      authToken: config.authToken,
      baseURL: config.baseUrl,
      defaultHeaders: { "User-Agent": "myagent/0.0.1" },
    });
  }

  async *stream(
    messages: Message[],
    tools?: ToolSchema[],
    options?: ProviderStreamOptions,
  ): AsyncGenerator<ModelEvent> {
    const anthropicMessages = convertMessages(messages);
    const anthropicTools = convertTools(tools);

    const params: Anthropic.MessageCreateParamsStreaming = {
      model: this.config.model,
      messages: anthropicMessages,
      max_tokens: this.config.maxOutputTokens ?? 16384,
      stream: true,
    };
    if (options?.systemPrompt) {
      params.system = options.systemPrompt;
    }
    if (anthropicTools) {
      params.tools = anthropicTools;
    }

    let stream;
    try {
      stream = this.client.messages.stream(params);
    } catch (err) {
      throw normalizeProviderError("anthropic", err);
    }

    let currentToolId = "";
    let currentToolName = "";
    let currentToolInput = "";
    let currentContentIndex = -1;
    const rawContent: Anthropic.ContentBlockParam[] = [];
    const reasoningByIndex = new Map<number, { text: string; signature?: string }>();

    try {
      for await (const event of stream) {
        switch (event.type) {
          case "content_block_start": {
            currentContentIndex = event.index;
            const block = event.content_block;
            if (block.type === "tool_use") {
              currentToolId = block.id;
              currentToolName = block.name;
              currentToolInput = "";
              rawContent[event.index] = {
                type: "tool_use",
                id: block.id,
                name: block.name,
                input: {},
              };
            } else if (block.type === "text") {
              rawContent[event.index] = { type: "text", text: "" };
            } else if (block.type === "thinking") {
              rawContent[event.index] = {
                type: "thinking",
                thinking: "",
                signature: "",
              } as Anthropic.ContentBlockParam;
            } else {
              rawContent[event.index] = block as Anthropic.ContentBlockParam;
            }
            break;
          }

          case "content_block_delta":
            if (event.delta.type === "text_delta") {
              yield { type: "text", delta: event.delta.text };
              const block = rawContent[currentContentIndex];
              if (block?.type === "text") {
                block.text += event.delta.text;
              }
            } else if (event.delta.type === "input_json_delta") {
              currentToolInput += event.delta.partial_json;
            } else if (event.delta.type === "thinking_delta") {
              const block = rawContent[currentContentIndex] as
                | (Anthropic.ContentBlockParam & { type: "thinking"; thinking: string })
                | undefined;
              if (block?.type === "thinking") block.thinking += event.delta.thinking;
              const current = reasoningByIndex.get(currentContentIndex) ?? { text: "" };
              current.text += event.delta.thinking;
              reasoningByIndex.set(currentContentIndex, current);
            } else if (event.delta.type === "signature_delta") {
              const block = rawContent[currentContentIndex] as
                | (Anthropic.ContentBlockParam & { type: "thinking"; signature: string })
                | undefined;
              if (block?.type === "thinking") block.signature = event.delta.signature;
              const current = reasoningByIndex.get(currentContentIndex) ?? { text: "" };
              current.signature = event.delta.signature;
              reasoningByIndex.set(currentContentIndex, current);
            }
            break;

          case "content_block_stop":
            if (currentToolId) {
              let input: unknown;
              try {
                input = JSON.parse(currentToolInput);
              } catch {
                throw new ProviderRuntimeError(
                  "anthropic",
                  "stream",
                  `Malformed tool-call arguments from provider: ${currentToolInput.slice(0, 80)}`,
                  {
                    hint: "provider returned malformed streaming tool-call data",
                  },
                );
              }
              const block = rawContent[currentContentIndex];
              if (block?.type === "tool_use") {
                block.input = input as Record<string, unknown>;
              }
              yield {
                type: "tool-call",
                id: currentToolId,
                name: currentToolName,
                input,
                providerMetadata: {
                  anthropic: {
                    contentIndex: currentContentIndex,
                    toolUseId: currentToolId,
                  },
                },
              };
              currentToolId = "";
              currentToolName = "";
              currentToolInput = "";
            } else {
              const reasoning = reasoningByIndex.get(event.index);
              if (reasoning?.text) {
                yield {
                  type: "reasoning",
                  id: `reasoning-${event.index}`,
                  delta: reasoning.text,
                  providerMetadata: {
                    anthropic: {
                      signature: reasoning.signature,
                    },
                    raw: rawContent.filter(Boolean),
                  },
                };
              }
            }
            break;

          case "message_delta":
            if (event.delta.stop_reason) {
              yield {
                type: "finish",
                reason: CANONICAL_STOP_REASON_MAP[event.delta.stop_reason] ?? "stop",
                providerMetadata: {
                  raw: rawContent.filter(Boolean),
                  anthropic: {
                    stopReason: event.delta.stop_reason,
                  },
                },
              };
            }
            break;
        }
      }
    } catch (err) {
      if (err instanceof ProviderRuntimeError) throw err;
      throw normalizeProviderError("anthropic", err);
    }
  }
}
