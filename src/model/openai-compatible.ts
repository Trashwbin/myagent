import OpenAI from "openai";
import type { Provider } from "./provider.js";
import type { ModelEvent, Message, ProviderConfig, ToolSchema } from "./types.js";

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
    });
  }

  async *stream(messages: Message[], tools?: ToolSchema[]): AsyncGenerator<ModelEvent> {
    const openaiMessages = convertMessages(messages);
    const openaiTools = convertTools(tools);

    const params: OpenAI.ChatCompletionCreateParamsStreaming = {
      model: this.config.model,
      messages: openaiMessages,
      stream: true,
    };
    if (openaiTools) {
      params.tools = openaiTools;
    }

    const stream = await this.client.chat.completions.create(params);

    const pendingToolCalls = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

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
            input = { raw: tc.arguments };
          }
          yield { type: "tool_call", id: tc.id, name: tc.name, input };
        }

        yield {
          type: "stop",
          reason: FINISH_REASON_MAP[choice.finish_reason] ?? "end_turn",
        };
      }
    }
  }
}
