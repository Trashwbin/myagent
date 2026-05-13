import {
  convertToModelMessages,
  jsonSchema,
  type ModelMessage,
  type ProviderMetadata as AiProviderMetadata,
  type ToolSet,
  type UIMessage,
} from "ai";

import type {
  Message,
  ProviderConfig,
  ProviderMetadata,
  ProviderProtocol,
  ToolSchema,
} from "./types.js";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type AiToolResultOutput =
  | { type: "text"; value: string }
  | { type: "json"; value: JsonValue };
type ProviderOptions = Record<string, Record<string, JsonValue | undefined>>;

function toAiProviderMetadata(metadata: ProviderMetadata | undefined): AiProviderMetadata | undefined {
  return metadata as AiProviderMetadata | undefined;
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

export function tools(tools?: ToolSchema[]): ToolSet | undefined {
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

export function providerOptions(input: {
  config: ProviderConfig;
  protocol: ProviderProtocol;
  messages: Message[];
}): ProviderOptions {
  if (input.config.provider !== "openai" || input.protocol !== "responses") {
    return {};
  }

  const previousResponseId = continuationResponseId(input.messages);
  return {
    openai: {
      store: true,
      ...(previousResponseId ? { previousResponseId } : {}),
    },
  };
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

function normalizeModelMessages(
  messages: ModelMessage[],
  config: ProviderConfig,
): ModelMessage[] {
  if (config.provider !== "anthropic") return messages;

  return messages
    .map((message) => {
      const content = message.content;
      if (typeof content === "string") return content ? message : undefined;
      if (!Array.isArray(content)) return message;

      const filtered = content.filter((part) => {
        if (part.type === "text" || part.type === "reasoning") return part.text !== "";
        return true;
      });
      return filtered.length > 0 ? ({ ...message, content: filtered } as ModelMessage) : undefined;
    })
    .filter((message): message is ModelMessage => message !== undefined);
}

export async function messages(input: {
  messages: Message[];
  config: ProviderConfig;
  tools?: ToolSet;
}): Promise<ModelMessage[]> {
  return normalizeModelMessages(
    await convertMessages(input.messages, input.tools),
    input.config,
  );
}
