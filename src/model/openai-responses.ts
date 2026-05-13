import type { Provider } from "./provider.js";
import type { ProviderStreamOptions } from "./provider.js";
import type { Message, ModelEvent, ModelUsage, ProviderConfig, ToolSchema } from "./types.js";
import { normalizeProviderError, ProviderRuntimeError } from "./errors.js";

type ResponsesInputItem =
  | { role: "system"; content: string }
  | { role: "user"; content: Array<{ type: "input_text"; text: string }> }
  | { role: "assistant"; content: Array<{ type: "output_text"; text: string }> }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

type ResponsesEvent = {
  type?: string;
  delta?: string;
  item_id?: string;
  call_id?: string;
  name?: string;
  item?: {
    type?: string;
    id?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    summary?: Array<{ type?: string; text?: string }>;
  };
  response?: {
    id?: string;
    status?: string;
    incomplete_details?: { reason?: string } | null;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
      output_tokens_details?: { reasoning_tokens?: number } | null;
    } | null;
  };
  code?: string;
  message?: string;
};

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export function convertMessages(
  messages: Message[],
  systemPrompt?: string,
): ResponsesInputItem[] {
  const input: ResponsesInputItem[] = [];
  if (systemPrompt) input.push({ role: "system", content: systemPrompt });

  for (const msg of messages) {
    switch (msg.role) {
      case "summary":
        input.push({
          role: "system",
          content: `<conversation_summary>\n${msg.content}\n</conversation_summary>`,
        });
        break;

      case "user":
        input.push({
          role: "user",
          content: [{ type: "input_text", text: msg.content }],
        });
        break;

      case "assistant": {
        const textParts = msg.parts?.filter((part) => part.type === "text") ?? [];
        if (textParts.length > 0 || (msg.content && !msg.toolCalls?.length)) {
          input.push({
            role: "assistant",
            content: [
              {
                type: "output_text",
                text:
                  textParts.length > 0
                    ? textParts.map((part) => part.text).join("")
                    : msg.content,
              },
            ],
          });
        }
        const toolCalls = msg.parts?.filter((part) => part.type === "tool-call") ?? [];
        const calls = toolCalls.length > 0 ? toolCalls : msg.toolCalls ?? [];
        for (const tc of calls) {
          input.push({
            type: "function_call",
            call_id: tc.id,
            name: tc.name,
            arguments: typeof tc.input === "string" ? tc.input : JSON.stringify(tc.input),
          });
        }
        break;
      }

      case "tool_result":
        input.push({
          type: "function_call_output",
          call_id: msg.toolCallId ?? "",
          output: msg.content,
        });
        break;
    }
  }

  return input;
}

function convertTools(tools?: ToolSchema[]) {
  if (!tools?.length) return undefined;
  return tools.map((tool) => ({
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function parseMaybeJsonString(text: string): unknown {
  const parsed = JSON.parse(text);
  return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
}

function extractJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const matches = [...text.matchAll(/\{[^]*?\}/g)];
    for (let i = matches.length - 1; i >= 0; i--) {
      const candidate = matches[i]?.[0];
      if (!candidate) continue;
      try {
        return JSON.parse(candidate);
      } catch {
        // Keep looking for the last valid object. Some proxies prefix `{}`.
      }
    }
    throw new ProviderRuntimeError(
      "openai",
      "stream",
      `Malformed function-call arguments from provider: ${text.slice(0, 80)}`,
      { hint: "provider returned malformed responses function-call data" },
    );
  }
}

function mapUsage(usage: NonNullable<ResponsesEvent["response"]>["usage"]): ModelUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens,
    providerMetadata: { openai: usage as Record<string, unknown> },
  };
}

function mapFinishReason(event: ResponsesEvent): "stop" | "tool-calls" | "length" | "error" {
  const incomplete = event.response?.incomplete_details?.reason;
  if (incomplete === "max_output_tokens") return "length";
  if (event.type === "response.failed" || event.type === "error") return "error";
  return "stop";
}

function sseEvents(body: string): ResponsesEvent[] {
  if (!body.trim().startsWith("event:")) {
    const parsed = parseMaybeJsonString(body) as { output?: unknown[]; id?: string; usage?: unknown };
    const events: ResponsesEvent[] = [];
    for (const item of parsed.output ?? []) {
      events.push({ type: "response.output_item.done", item: item as ResponsesEvent["item"] });
    }
    events.push({
      type: "response.completed",
      response: {
        id: parsed.id,
        usage: parsed.usage as NonNullable<ResponsesEvent["response"]>["usage"],
      },
    });
    return events;
  }

  const events: ResponsesEvent[] = [];
  for (const frame of body.split(/\n\n+/)) {
    const data = frame
      .split(/\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    events.push(JSON.parse(data) as ResponsesEvent);
  }
  return events;
}

export class OpenAIResponsesProvider implements Provider {
  readonly name = "openai";

  constructor(private config: ProviderConfig) {}

  async *stream(
    messages: Message[],
    tools?: ToolSchema[],
    options?: ProviderStreamOptions,
  ): AsyncGenerator<ModelEvent> {
    const apiKey = this.config.apiKey;
    if (!apiKey) {
      throw new ProviderRuntimeError("openai", "auth", "OpenAI Responses provider requires apiKey");
    }

    const body = {
      model: this.config.model,
      input: convertMessages(messages, options?.systemPrompt),
      tools: convertTools(tools),
      stream: true,
      max_output_tokens: this.config.maxOutputTokens,
    };

    let response: Response;
    try {
      response = await fetch(`${trimBaseUrl(this.config.baseUrl ?? DEFAULT_BASE_URL)}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "user-agent": "myagent/0.0.1",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw normalizeProviderError("openai", err);
    }

    const text = await response.text();
    if (!response.ok) {
      let message = text;
      try {
        const parsed = parseMaybeJsonString(text) as { error?: { message?: string } };
        message = parsed.error?.message ?? text;
      } catch {
        // Use raw body as message.
      }
      throw new ProviderRuntimeError("openai", "upstream", message, {
        status: response.status,
      });
    }

    const pendingTools = new Map<
      string,
      { id: string; name: string; arguments: string; itemId: string; callId?: string }
    >();
    const reasoningText = new Map<string, string>();
    let hasToolCall = false;

    try {
      for (const event of sseEvents(text)) {
        if (event.type === "response.output_text.delta" && event.delta) {
          yield { type: "text", id: event.item_id, delta: event.delta };
          continue;
        }

        if (event.type === "response.reasoning_summary_text.delta" && event.item_id && event.delta) {
          reasoningText.set(
            event.item_id,
            `${reasoningText.get(event.item_id) ?? ""}${event.delta}`,
          );
          continue;
        }

        if (event.type === "response.output_item.added" && event.item?.type === "function_call") {
          if (!event.item.id) continue;
          pendingTools.set(event.item.id, {
            id: event.item.call_id ?? event.item.id,
            callId: event.item.call_id,
            itemId: event.item.id,
            name: event.item.name ?? "",
            arguments: event.item.arguments ?? "",
          });
          continue;
        }

        if (event.type === "response.function_call_arguments.delta" && event.item_id && event.delta) {
          const pending = pendingTools.get(event.item_id) ?? {
            id: event.call_id ?? event.item_id,
            callId: event.call_id,
            itemId: event.item_id,
            name: event.name ?? "",
            arguments: "",
          };
          pending.arguments += event.delta;
          if (event.call_id) {
            pending.id = event.call_id;
            pending.callId = event.call_id;
          }
          if (event.name) pending.name = event.name;
          pendingTools.set(event.item_id, pending);
          continue;
        }

        if (event.type === "response.output_item.done" && event.item?.type === "reasoning") {
          const summaryText =
            event.item.summary
              ?.map((item) => (item.type === "summary_text" ? item.text ?? "" : ""))
              .join("") ?? "";
          const delta =
            (event.item.id ? reasoningText.get(event.item.id) : undefined) ||
            summaryText ||
            JSON.stringify(event.item);
          yield {
            type: "reasoning",
            id: event.item.id,
            delta,
            providerMetadata: { openai: { itemId: event.item.id, item: event.item } },
          };
          continue;
        }

        if (event.type === "response.output_item.done" && event.item?.type === "function_call") {
          if (!event.item.id) continue;
          const pending = pendingTools.get(event.item.id);
          const name = event.item.name ?? pending?.name;
          if (!name) continue;
          const id = event.item.call_id ?? pending?.id ?? event.item.id;
          const args = event.item.arguments ?? pending?.arguments ?? "{}";
          hasToolCall = true;
          yield {
            type: "tool-call",
            id,
            name,
            input: extractJsonObject(args),
            providerMetadata: {
              openai: {
                itemId: event.item.id,
                callId: event.item.call_id ?? pending?.callId,
              },
            },
          };
          pendingTools.delete(event.item.id);
          continue;
        }

        if (
          event.type === "response.completed" ||
          event.type === "response.incomplete" ||
          event.type === "response.failed" ||
          event.type === "error"
        ) {
          if (event.type === "response.failed" || event.type === "error") {
            yield {
              type: "finish",
              reason: "error",
              providerMetadata: { openai: { code: event.code, message: event.message } },
            };
            continue;
          }
          yield {
            type: "finish",
            reason:
              hasToolCall && mapFinishReason(event) === "stop"
                ? "tool-calls"
                : mapFinishReason(event),
            usage: mapUsage(event.response?.usage),
            providerMetadata: {
              openai: {
                responseId: event.response?.id,
                status: event.response?.status,
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
