import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
  jsonSchema,
  streamText,
  type FinishReason,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type ProviderMetadata as AiProviderMetadata,
  type TextStreamPart,
  type ToolSet,
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

function toolResultOutput(content: string): AiToolResultOutput {
  try {
    return { type: "json", value: JSON.parse(content) as JsonValue };
  } catch {
    return { type: "text", value: content };
  }
}

export function convertMessages(messages: Message[]): ModelMessage[] {
  const result: ModelMessage[] = [];
  type PendingToolResult = Extract<ModelMessage, { role: "tool" }>["content"][number];
  let pendingToolResults: PendingToolResult[] = [];

  const flushToolResults = () => {
    if (pendingToolResults.length === 0) return;
    result.push({ role: "tool", content: pendingToolResults });
    pendingToolResults = [];
  };

  for (const msg of messages) {
    if (msg.role !== "tool_result") flushToolResults();

    switch (msg.role) {
      case "summary":
        result.push({
          role: "system",
          content: `<conversation_summary>\n${msg.content}\n</conversation_summary>`,
        });
        break;

      case "user":
        result.push({ role: "user", content: msg.content });
        break;

      case "assistant": {
        const content: Extract<ModelMessage, { role: "assistant" }>["content"] = [];
        const parts = msg.parts ?? [];
        for (const part of parts) {
          if (part.type === "reasoning") {
            content.push({
              type: "reasoning",
              text: part.text,
              providerOptions: part.providerMetadata as AiProviderMetadata | undefined,
            });
          } else if (part.type === "text") {
            content.push({
              type: "text",
              text: part.text,
              providerOptions: part.providerMetadata as AiProviderMetadata | undefined,
            });
          }
        }

        const hasTextPart = parts.some((part) => part.type === "text");
        if (!hasTextPart && msg.content) {
          content.push({ type: "text", text: msg.content });
        }

        const partToolCalls = parts.filter((part) => part.type === "tool-call");
        const calls = partToolCalls.length > 0 ? partToolCalls : msg.toolCalls ?? [];
        for (const tc of calls) {
          content.push({
            type: "tool-call",
            toolCallId: tc.id,
            toolName: tc.name,
            input: tc.input,
            providerOptions: tc.providerMetadata as AiProviderMetadata | undefined,
          });
        }

        result.push({
          role: "assistant",
          content,
          providerOptions: msg.providerMetadata as AiProviderMetadata | undefined,
        });
        break;
      }

      case "tool_result":
        pendingToolResults.push({
          type: "tool-result",
          toolCallId: msg.toolCallId ?? "",
          toolName: msg.toolName ?? "",
          output: toolResultOutput(msg.content),
          providerOptions: msg.providerMetadata as AiProviderMetadata | undefined,
        });
        break;
    }
  }

  flushToolResults();
  return result;
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

    const result = streamText({
      model: createLanguageModel({ ...this.config, protocol: this.protocol }),
      messages: convertMessages(messages),
      tools: convertTools(tools),
      system: options?.systemPrompt,
      maxOutputTokens: this.config.maxOutputTokens,
      providerOptions,
      stopWhen: undefined,
      maxRetries: 0,
    });

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
