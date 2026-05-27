import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
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
  ProviderAdapter,
  ProviderKind,
  ProviderMetadata,
  ProviderMode,
  ToolSchema,
} from "./types.js";
import { normalizeProviderError, ProviderRuntimeError } from "./errors.js";
import * as ProviderTransform from "./provider-transform.js";

type AiSdkMode = ProviderMode;

function toProviderMetadata(
  metadata: AiProviderMetadata | undefined,
): ProviderMetadata | undefined {
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

export function mapStreamPartToModelEvent(
  part: TextStreamPart<ToolSet>,
  provider: ProviderKind,
): ModelEvent | undefined {
  switch (part.type) {
    case "start":
      return { type: "start" };

    case "start-step":
      return {
        type: "step-start",
      };

    case "text-start":
      return {
        type: "text-start",
        id: part.id,
        providerMetadata: toProviderMetadata(part.providerMetadata),
      };

    case "text-delta":
      return {
        type: "text",
        id: part.id,
        delta: part.text,
        providerMetadata: toProviderMetadata(part.providerMetadata),
      };

    case "text-end":
      return {
        type: "text-end",
        id: part.id,
        providerMetadata: toProviderMetadata(part.providerMetadata),
      };

    case "reasoning-start":
      return {
        type: "reasoning-start",
        id: part.id,
        providerMetadata: toProviderMetadata(part.providerMetadata),
      };

    case "reasoning-delta":
      return {
        type: "reasoning",
        id: part.id,
        delta: part.text,
        providerMetadata: toProviderMetadata(part.providerMetadata),
      };

    case "reasoning-end":
      return {
        type: "reasoning-end",
        id: part.id,
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

    case "tool-error":
      return {
        type: "tool-result",
        id: part.toolCallId,
        name: part.toolName,
        result: part.error,
        isError: true,
        providerMetadata: toProviderMetadata(part.providerMetadata),
      };

    case "tool-output-denied":
      return {
        type: "tool-result",
        id: part.toolCallId,
        name: part.toolName,
        result: "Tool output denied.",
        isError: true,
      };

    case "finish-step":
      return {
        type: "step-finish",
        reason: toFinishReason(part.finishReason),
        usage: toUsage(part.usage),
        providerMetadata: toProviderMetadata(part.providerMetadata),
      };

    case "finish":
      return {
        type: "finish",
        reason: toFinishReason(part.finishReason),
        usage: toUsage(part.totalUsage),
      };

    case "abort":
      return {
        type: "abort",
        reason: part.reason,
      };

    case "error":
      throw normalizeProviderError(provider, part.error);

    default:
      return undefined;
  }
}

function createLanguageModel(config: ProviderConfig): LanguageModel {
  if (config.provider === "openai") {
    if (config.adapter === "@ai-sdk/openai-compatible") {
      const compatible = createOpenAICompatible({
        name: "openai-compatible",
        apiKey: config.apiKey,
        baseURL: config.baseUrl ?? "https://api.openai.com/v1",
        headers: { "User-Agent": "myagent/0.0.1" },
        includeUsage: true,
      });
      return compatible.chatModel(config.model as never);
    }

    const openai = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      headers: { "User-Agent": "myagent/0.0.1" },
    });
    return config.mode === "chat"
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

function isOfficialOpenAIBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return true;
  try {
    const url = new URL(baseUrl);
    return url.hostname === "api.openai.com";
  } catch {
    return false;
  }
}

function defaultOpenAIMode(config: ProviderConfig): AiSdkMode {
  if (config.adapter === "@ai-sdk/openai-compatible") return "chat";
  return isOfficialOpenAIBaseUrl(config.baseUrl) ? "responses" : "chat";
}

export class AiSdkProvider implements Provider {
  readonly name: ProviderKind;
  readonly adapter: ProviderAdapter;
  readonly mode: AiSdkMode;

  constructor(private config: ProviderConfig) {
    this.name = config.provider;
    this.adapter =
      config.adapter ??
      (config.provider === "anthropic" ? "@ai-sdk/anthropic" : "@ai-sdk/openai");
    const mode = this.adapter === "@ai-sdk/openai-compatible" ? "chat" : config.mode;
    this.mode =
      config.provider === "anthropic" ? "messages" : (mode ?? defaultOpenAIMode(config));
  }

  async *stream(
    messages: Message[],
    tools?: ToolSchema[],
    options?: ProviderStreamOptions,
  ): AsyncGenerator<ModelEvent> {
    let result: ReturnType<typeof streamText<ToolSet, never>>;
    try {
      const aiTools = ProviderTransform.tools(tools);
      const summaryPrompt = ProviderTransform.conversationSummarySystemPrompt(messages);
      result = streamText({
        model: createLanguageModel({ ...this.config, mode: this.mode }),
        messages: await ProviderTransform.messages({
          messages,
          config: this.config,
          tools: aiTools,
        }),
        tools: aiTools,
        system:
          [options?.systemPrompt, summaryPrompt].filter(Boolean).join("\n\n") ||
          undefined,
        maxOutputTokens: this.config.maxOutputTokens,
        providerOptions: ProviderTransform.providerOptions({
          config: this.config,
          mode: this.mode,
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
        const event = mapStreamPartToModelEvent(part, this.name);
        if (event) yield event;
      }
    } catch (err) {
      if (err instanceof ProviderRuntimeError) throw err;
      throw normalizeProviderError(this.name, err);
    }
  }
}
