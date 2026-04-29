import Anthropic from "@anthropic-ai/sdk";
import type { Provider } from "./provider.js";
import type { ModelEvent, Message, ProviderConfig, ToolSchema } from "./types.js";

type StopReason = "end_turn" | "tool_use" | "length";

const STOP_REASON_MAP: Record<string, StopReason> = {
  end_turn: "end_turn",
  tool_use: "tool_use",
  max_tokens: "length",
  stop_sequence: "end_turn",
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

      case "assistant": {
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
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }

  async *stream(messages: Message[], tools?: ToolSchema[]): AsyncGenerator<ModelEvent> {
    const anthropicMessages = convertMessages(messages);
    const anthropicTools = convertTools(tools);

    const params: Anthropic.MessageCreateParamsStreaming = {
      model: this.config.model,
      messages: anthropicMessages,
      max_tokens: 8192,
      stream: true,
    };
    if (anthropicTools) {
      params.tools = anthropicTools;
    }

    const stream = this.client.messages.stream(params);

    let currentToolId = "";
    let currentToolName = "";
    let currentToolInput = "";

    for await (const event of stream) {
      switch (event.type) {
        case "content_block_delta":
          if (event.delta.type === "text_delta") {
            yield { type: "text_delta", text: event.delta.text };
          } else if (event.delta.type === "input_json_delta") {
            currentToolInput += event.delta.partial_json;
          }
          break;

        case "content_block_start":
          if (event.content_block.type === "tool_use") {
            currentToolId = event.content_block.id;
            currentToolName = event.content_block.name;
            currentToolInput = "";
          }
          break;

        case "content_block_stop":
          if (currentToolId) {
            let input: unknown;
            try {
              input = JSON.parse(currentToolInput);
            } catch {
              input = { raw: currentToolInput };
            }
            yield {
              type: "tool_call",
              id: currentToolId,
              name: currentToolName,
              input,
            };
            currentToolId = "";
            currentToolName = "";
            currentToolInput = "";
          }
          break;

        case "message_delta":
          if (event.delta.stop_reason) {
            yield {
              type: "stop",
              reason: STOP_REASON_MAP[event.delta.stop_reason] ?? "end_turn",
            };
          }
          break;
      }
    }
  }
}
