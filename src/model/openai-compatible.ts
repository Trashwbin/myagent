import OpenAI from "openai";
import type { Provider } from "./provider.js";
import type { ProviderStreamOptions } from "./provider.js";
import type { ModelEvent, Message, ProviderConfig, ToolSchema } from "./types.js";
import { normalizeProviderError, ProviderRuntimeError } from "./errors.js";

type StopReason = "end_turn" | "tool_use" | "length";

const FINISH_REASON_MAP: Record<string, StopReason> = {
  stop: "end_turn",
  tool_calls: "tool_use",
  length: "length",
};

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

export function convertMessagesWithToolResultsAsText(
  messages: Message[],
): OpenAI.ChatCompletionMessageParam[] {
  return messages.flatMap((msg): OpenAI.ChatCompletionMessageParam[] => {
    if (msg.role === "assistant" && msg.toolCalls?.length) {
      const parts = [];
      if (msg.content.trim()) parts.push(msg.content);
      for (const call of msg.toolCalls) {
        parts.push(
          `<tool_call id="${escapeAttribute(call.id)}" name="${escapeAttribute(call.name)}">\n${formatToolInput(call.input)}\n</tool_call>`,
        );
      }
      return [
        {
          role: "assistant" as const,
          content: parts.join("\n\n"),
        },
      ];
    }

    if (msg.role !== "tool_result") return convertMessages([msg]);

    const toolName = msg.toolName || "tool";
    const toolCallId = msg.toolCallId
      ? ` id="${escapeAttribute(msg.toolCallId)}"`
      : "";
    return [
      {
        role: "user" as const,
        content: `<tool_result name="${escapeAttribute(toolName)}"${toolCallId}>\n${msg.content}\n</tool_result>`,
      },
    ];
  });
}

function formatToolInput(input: unknown): string {
  return typeof input === "string" ? input : JSON.stringify(input);
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
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
      const normalized = normalizeProviderError("openai", err);
      if (shouldRetryWithTextToolResults(normalized, messages)) {
        try {
          stream = await this.client.chat.completions.create({
            ...params,
            messages: options?.systemPrompt
              ? [
                  { role: "system", content: options.systemPrompt },
                  ...convertMessagesWithToolResultsAsText(messages),
                ]
              : convertMessagesWithToolResultsAsText(messages),
          });
        } catch (retryErr) {
          throw normalizeProviderError("openai", retryErr);
        }
      } else {
        throw normalized;
      }
    }

    const pendingToolCalls = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    try {
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;

        if (delta.content) {
          yield { type: "text_delta", text: delta.content };
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
              type: "tool_call",
              id: tc.id,
              name: tc.name,
              input,
            };
          }

          yield {
            type: "stop",
            reason: FINISH_REASON_MAP[choice.finish_reason] ?? "end_turn",
          };
        }
      }
    } catch (err) {
      if (err instanceof ProviderRuntimeError) throw err;
      throw normalizeProviderError("openai", err);
    }
  }
}

function shouldRetryWithTextToolResults(
  err: ProviderRuntimeError,
  messages: Message[],
): boolean {
  return (
    err.status === 400 &&
    messages.some((message) => message.role === "tool_result")
  );
}
