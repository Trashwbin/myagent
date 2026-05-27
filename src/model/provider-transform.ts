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
  ProviderMode,
  ToolSchema,
} from "./types.js";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
type AiToolResultOutput =
  | { type: "text"; value: string }
  | { type: "json"; value: JsonValue };
type ProviderOptions = Record<string, Record<string, JsonValue | undefined>>;
const RESPONSE_OPTION_KEYS = [
  "store",
  "reasoningEffort",
  "reasoningSummary",
  "textVerbosity",
  "systemMessageMode",
] as const;

function toAiProviderMetadata(
  metadata: ProviderMetadata | undefined,
): AiProviderMetadata | undefined {
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
  return typeof responseId === "string" && responseId.length > 0 ? responseId : undefined;
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
  mode: ProviderMode;
  messages: Message[];
}): ProviderOptions {
  if (input.config.provider !== "openai" || input.mode !== "responses") {
    return {};
  }

  const previousResponseId = continuationResponseId(input.messages);
  const configured = pickResponseOptions(input.config.options);
  return {
    openai: {
      store: true,
      ...configured,
      ...(previousResponseId ? { previousResponseId } : {}),
    },
  };
}

function pickResponseOptions(
  options: Record<string, unknown> | undefined,
): Record<string, JsonValue | undefined> {
  if (!options) return {};
  const result: Record<string, JsonValue | undefined> = {};
  for (const key of RESPONSE_OPTION_KEYS) {
    if (isJsonValue(options[key])) result[key] = options[key];
  }
  return result;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).every(isJsonValue);
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

export function conversationSummarySystemPrompt(messages: Message[]): string | undefined {
  const summaries = messages
    .filter((message) => message.role === "summary")
    .map((message) => message.content.trim())
    .filter(Boolean);
  if (summaries.length === 0) return undefined;
  return summaries
    .map((summary) => `<conversation_summary>\n${summary}\n</conversation_summary>`)
    .join("\n\n");
}

function normalizeModelMessages(
  messages: ModelMessage[],
  config: ProviderConfig,
): ModelMessage[] {
  if (config.provider !== "anthropic") return messages;

  return messages
    .map((message) => {
      const content = message.content;
      if (typeof content === "string") {
        return content ? stripProviderOptions(message) : undefined;
      }
      if (!Array.isArray(content)) return message;

      const filtered = content.filter((part) => {
        if (part.type === "reasoning") return false;
        if (part.type === "text") return part.text !== "";
        return true;
      });
      return filtered.length > 0
        ? ({ ...stripProviderOptions(message), content: filtered } as ModelMessage)
        : undefined;
    })
    .filter((message): message is ModelMessage => message !== undefined);
}

function stripProviderOptions(message: ModelMessage): ModelMessage {
  if (message.role === "system") return message;
  if (typeof message.content === "string") return message;
  if (!Array.isArray(message.content)) return message;
  return {
    ...message,
    content: message.content.map((part) => {
      if (typeof part !== "object" || part === null) return part;
      const {
        providerOptions: _providerOptions,
        callProviderOptions: _callProviderOptions,
        resultProviderOptions: _resultProviderOptions,
        ...rest
      } = part as Record<string, unknown>;
      return rest;
    }) as ModelMessage["content"],
  } as ModelMessage;
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
