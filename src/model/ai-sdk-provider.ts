import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
  streamText,
  type FinishReason,
  type LanguageModel,
  type LanguageModelUsage,
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
import * as ProviderTransform from "./provider-transform.js";

type AiSdkProtocol = "chat" | "responses" | "messages";

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
    let result: ReturnType<typeof streamText<ToolSet, never>>;
    try {
      const aiTools = ProviderTransform.tools(tools);
      result = streamText({
        model: createLanguageModel({ ...this.config, protocol: this.protocol }),
        messages: await ProviderTransform.messages({
          messages,
          config: this.config,
          tools: aiTools,
        }),
        tools: aiTools,
        system: options?.systemPrompt,
        maxOutputTokens: this.config.maxOutputTokens,
        providerOptions: ProviderTransform.providerOptions({
          config: this.config,
          protocol: this.protocol,
          messages,
        }),
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
