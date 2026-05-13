import OpenAI from "openai";
import type { Provider } from "./provider.js";
import type { ProviderStreamOptions } from "./provider.js";
import type { ModelEvent, Message, ProviderConfig, ToolSchema } from "./types.js";
import { normalizeProviderError, ProviderRuntimeError } from "./errors.js";

type FinishReason = "stop" | "tool-calls" | "length";

const CANONICAL_FINISH_REASON_MAP: Record<string, FinishReason> = {
  stop: "stop",
  tool_calls: "tool-calls",
  length: "length",
};

function openAIProviderRaw(value: unknown): { reasoning_content: string } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  if (typeof raw.reasoning_content === "string" && raw.reasoning_content.length > 0) {
    return { reasoning_content: raw.reasoning_content };
  }
  return undefined;
}

export function convertMessages(
  messages: Message[],
): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((msg) => {
    switch (msg.role) {
      case "user":
        return { role: "user" as const, content: msg.content };

      case "summary":
        return {
          role: "system" as const,
          content: `<conversation_summary>\n${msg.content}\n</conversation_summary>`,
        };

      case "assistant": {
        const result: OpenAI.ChatCompletionAssistantMessageParam = {
          role: "assistant",
          content: msg.content || null,
        };
        if (msg.toolCalls?.length) {
          result.tool_calls = msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments:
                typeof tc.input === "string" ? tc.input : JSON.stringify(tc.input),
            },
          }));
        }
        const raw = openAIProviderRaw(msg.providerRaw);
        if (raw) {
          (result as OpenAI.ChatCompletionAssistantMessageParam & {
            reasoning_content?: string;
          }).reasoning_content = raw.reasoning_content;
        }
        return result;
      }

      case "tool_result":
        return {
          role: "tool" as const,
          tool_call_id: msg.toolCallId ?? "",
          content: msg.content,
        };
    }
  });
}

function convertTools(tools?: ToolSchema[]): OpenAI.ChatCompletionTool[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export class OpenAICompatibleProvider implements Provider {
  readonly name = "openai";
  private client: OpenAI;

  constructor(private config: ProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      defaultHeaders: { "User-Agent": "myagent/0.0.1" },
    });
  }

  async *stream(
    messages: Message[],
    tools?: ToolSchema[],
    options?: ProviderStreamOptions,
  ): AsyncGenerator<ModelEvent> {
    const openaiMessages = convertMessages(messages);
    const openaiTools = convertTools(tools);

    const params: OpenAI.ChatCompletionCreateParamsStreaming = {
      model: this.config.model,
      messages: options?.systemPrompt
        ? [{ role: "system", content: options.systemPrompt }, ...openaiMessages]
        : openaiMessages,
      stream: true,
    };
    if (this.config.maxOutputTokens !== undefined) {
      params.max_tokens = this.config.maxOutputTokens;
    }
    if (openaiTools) {
      params.tools = openaiTools;
    }

    let stream;
    try {
      stream = await this.client.chat.completions.create(params);
    } catch (err) {
      throw normalizeProviderError("openai", err);
    }

    const pendingToolCalls = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    let reasoningContent = "";

    try {
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;
        const rawDelta = delta as Record<string, unknown>;

        if (typeof rawDelta.reasoning_content === "string") {
          reasoningContent += rawDelta.reasoning_content;
        } else if (typeof rawDelta.reasoning === "string") {
          reasoningContent += rawDelta.reasoning;
        }

        if (delta.content) {
          yield { type: "text", delta: delta.content };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const pending = pendingToolCalls.get(idx) ?? {
              id: "",
              name: "",
              arguments: "",
            };
            if (tc.id) {
              pending.id = tc.id;
            }
            if (tc.function?.name) {
              pending.name += tc.function.name;
            }
            if (tc.function?.arguments) {
              pending.arguments += tc.function.arguments;
            }
            pendingToolCalls.set(idx, pending);
          }
        }

        if (choice.finish_reason) {
          for (const [, tc] of pendingToolCalls) {
            let input: unknown;
            try {
              input = JSON.parse(tc.arguments);
            } catch {
              throw new ProviderRuntimeError(
                "openai",
                "stream",
                `Malformed tool-call arguments from provider: ${tc.arguments.slice(0, 80)}`,
                {
                  hint: "provider returned malformed streaming tool-call data",
                },
              );
            }
            yield {
              type: "tool-call",
              id: tc.id,
              name: tc.name,
              input,
              providerMetadata: {
                openaiCompatible: {
                  toolCallId: tc.id,
                },
              },
            };
          }

          if (reasoningContent.length > 0) {
            yield {
              type: "reasoning",
              id: "reasoning-0",
              delta: reasoningContent,
              providerMetadata: {
                openaiCompatible: { reasoning_content: reasoningContent },
              },
            };
          }

          yield {
            type: "finish",
            reason: CANONICAL_FINISH_REASON_MAP[choice.finish_reason] ?? "stop",
            providerMetadata: {
              openaiCompatible: {
                finishReason: choice.finish_reason,
              },
            },
          };
        }
      }
    } catch (err) {
      if (err instanceof ProviderRuntimeError) throw err;
      throw normalizeProviderError("openai", err);
    }
  }
}
