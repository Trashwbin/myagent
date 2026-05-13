import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  jsonSchema,
  streamText,
  type FinishReason,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type ProviderMetadata as AiProviderMetadata,
  type TextStreamPart,
  type ToolSet,
  type UIMessage,
} from "ai";

import type { Provider } from "./provider.js";
import type { ProviderStreamOptions } from "./provider.js";
import type {
  Message,
  ModelEvent,
  ModelFinishReason,
  ModelUsage,
  ProviderConfig,
  ProviderKind,
  ProviderMetadata,
  ToolSchema,
} from "./types.js";
import { normalizeProviderError, ProviderRuntimeError } from "./errors.js";

type AiSdkProtocol = "chat" | "responses" | "messages";
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type AiToolResultOutput =
  | { type: "text"; value: string }
  | { type: "json"; value: JsonValue };

function toProviderMetadata(metadata: AiProviderMetadata | undefined): ProviderMetadata | undefined {
  return metadata as ProviderMetadata | undefined;
}

function toAiProviderMetadata(metadata: ProviderMetadata | undefined): AiProviderMetadata | undefined {
  return metadata as AiProviderMetadata | undefined;
}

function toUsage(usage: LanguageModelUsage | undefined): ModelUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens: usage.outputTokenDetails.reasoningTokens ?? usage.reasoningTokens,
    providerMetadata: usage.raw ? { raw: usage.raw } : undefined,
  };
}

function toFinishReason(reason: FinishReason): ModelFinishReason {
  switch (reason) {
    case "tool-calls":
      return "tool-calls";
    case "length":
      return "length";
    case "error":
      return "error";
    case "stop":
    case "content-filter":
    case "other":
      return "stop";
  }
}

function toToolResultOutput(content: string): AiToolResultOutput {
  try {
    return { type: "json", value: JSON.parse(content) as JsonValue };
  } catch {
    return { type: "text", value: content };
  }
}

function toToolOutput(content: string): unknown {
  const output = toToolResultOutput(content);
  return output.type === "json" ? output.value : output.value;
}

export function convertMessagesToUI(messages: Message[]): UIMessage[] {
  const result: UIMessage[] = [];
  const activeToolCalls = new Map<
    string,
    {
      message: UIMessage;
      partIndex: number;
      toolName: string;
      input: unknown;
      providerMetadata?: ProviderMetadata;
    }
  >();

  for (const msg of messages) {
    switch (msg.role) {
      case "summary":
        result.push({
          id: `summary-${result.length}`,
          role: "system",
          parts: [
            {
              type: "text",
              text: `<conversation_summary>\n${msg.content}\n</conversation_summary>`,
            },
          ],
        });
        break;

      case "user":
        result.push({
          id: `user-${result.length}`,
          role: "user",
          parts: [{ type: "text", text: msg.content }],
        });
        break;

      case "assistant": {
        const uiMessage: UIMessage = {
          id: `assistant-${result.length}`,
          role: "assistant",
          parts: [],
          metadata: msg.providerMetadata,
        };
        const parts = msg.parts ?? [];
        for (const part of parts) {
          if (part.type === "reasoning") {
            uiMessage.parts.push({
              type: "reasoning",
              text: part.text,
              providerMetadata: toAiProviderMetadata(part.providerMetadata),
            });
          } else if (part.type === "text") {
            uiMessage.parts.push({
              type: "text",
              text: part.text,
              providerMetadata: toAiProviderMetadata(part.providerMetadata),
            });
          }
        }

        for (const tc of parts.filter((part) => part.type === "tool-call")) {
          const partIndex = uiMessage.parts.length;
          uiMessage.parts.push({
            type: `tool-${tc.name}`,
            toolCallId: tc.id,
            state: "input-available",
            input: tc.input,
            callProviderMetadata: toAiProviderMetadata(tc.providerMetadata),
          });
          activeToolCalls.set(tc.id, {
            message: uiMessage,
            partIndex,
            toolName: tc.name,
            input: tc.input,
            providerMetadata: tc.providerMetadata,
          });
        }

        result.push(uiMessage);
        break;
      }

      case "tool_result": {
        const toolCallId = msg.toolCallId ?? "";
        const active = activeToolCalls.get(toolCallId);
        if (!active) {
          throw new Error(`Tool result without matching tool call: ${toolCallId}`);
        }
        active.message.parts[active.partIndex] = {
          type: `tool-${active.toolName}`,
          toolCallId,
          state: "output-available",
          input: active.input,
          output: toToolOutput(msg.content),
          callProviderMetadata: toAiProviderMetadata(active.providerMetadata),
          resultProviderMetadata: toAiProviderMetadata(msg.providerMetadata),
        };
        activeToolCalls.delete(toolCallId);
        break;
      }
    }
  }

  return result;
}

export async function convertMessages(
  messages: Message[],
  tools?: ToolSet,
): Promise<ModelMessage[]> {
  return convertToModelMessages(convertMessagesToUI(messages), { tools });
}

function convertTools(tools?: ToolSchema[]): ToolSet | undefined {
  if (!tools?.length) return undefined;
  return Object.fromEntries(
    tools.map((tool) => [
      tool.name,
      {
        description: tool.description,
        inputSchema: jsonSchema(tool.parameters),
      },
    ]),
  ) as ToolSet;
}

function continuationResponseId(messages: Message[]): string | undefined {
  const lastAssistant = messages.findLast((message) => message.role === "assistant");
  const openai = lastAssistant?.providerMetadata?.openai;
  if (typeof openai !== "object" || openai === null || Array.isArray(openai)) {
    return undefined;
  }
  const responseId = (openai as Record<string, unknown>).responseId;
  return typeof responseId === "string" && responseId.length > 0
    ? responseId
    : undefined;
}

function createLanguageModel(config: ProviderConfig): LanguageModel {
  if (config.provider === "openai") {
    const openai = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      headers: { "User-Agent": "myagent/0.0.1" },
    });
    return config.protocol === "chat"
      ? openai.chat(config.model as never)
      : openai.responses(config.model as never);
  }

  const anthropic = createAnthropic({
    apiKey: config.authToken ? undefined : config.apiKey,
    authToken: config.authToken,
    baseURL: config.baseUrl,
    headers: { "User-Agent": "myagent/0.0.1" },
  });
  return anthropic.messages(config.model as never);
}

export class AiSdkProvider implements Provider {
  readonly name: ProviderKind;
  readonly protocol: AiSdkProtocol;

  constructor(private config: ProviderConfig) {
    this.name = config.provider;
    this.protocol =
      config.provider === "anthropic" ? "messages" : config.protocol ?? "responses";
  }

  async *stream(
    messages: Message[],
    tools?: ToolSchema[],
    options?: ProviderStreamOptions,
  ): AsyncGenerator<ModelEvent> {
    const providerOptions: Record<string, Record<string, string | boolean>> = {};
    if (this.config.provider === "openai" && this.protocol === "responses") {
      const previousResponseId = continuationResponseId(messages);
      providerOptions.openai = {
        store: true,
        ...(previousResponseId ? { previousResponseId } : {}),
      };
    }

    let result: ReturnType<typeof streamText<ToolSet, never>>;
    try {
      const aiTools = convertTools(tools);
      result = streamText({
        model: createLanguageModel({ ...this.config, protocol: this.protocol }),
        messages: await convertMessages(messages, aiTools),
        tools: aiTools,
        system: options?.systemPrompt,
        maxOutputTokens: this.config.maxOutputTokens,
        providerOptions,
        stopWhen: undefined,
        maxRetries: 0,
      });
    } catch (err) {
      if (err instanceof ProviderRuntimeError) throw err;
      throw normalizeProviderError(this.name, err);
    }

    try {
      for await (const part of result.fullStream) {
        const event = this.mapStreamPart(part);
        if (event) yield event;
      }
    } catch (err) {
      if (err instanceof ProviderRuntimeError) throw err;
      throw normalizeProviderError(this.name, err);
    }
  }

  private mapStreamPart(part: TextStreamPart<ToolSet>): ModelEvent | undefined {
    switch (part.type) {
      case "text-delta":
        return {
          type: "text",
          id: part.id,
          delta: part.text,
          providerMetadata: toProviderMetadata(part.providerMetadata),
        };

      case "reasoning-delta":
        return {
          type: "reasoning",
          id: part.id,
          delta: part.text,
          providerMetadata: toProviderMetadata(part.providerMetadata),
        };

      case "tool-call":
        return {
          type: "tool-call",
          id: part.toolCallId,
          name: part.toolName,
          input: part.input,
          providerMetadata: toProviderMetadata(part.providerMetadata),
        };

      case "tool-result":
        return {
          type: "tool-result",
          id: part.toolCallId,
          name: part.toolName,
          result: part.output,
          providerMetadata: toProviderMetadata(part.providerMetadata),
        };

      case "finish-step":
        return {
          type: "finish",
          reason: toFinishReason(part.finishReason),
          usage: toUsage(part.usage),
          providerMetadata: toProviderMetadata(part.providerMetadata),
        };

      case "error":
        throw normalizeProviderError(this.name, part.error);

      default:
        return undefined;
    }
  }
}
