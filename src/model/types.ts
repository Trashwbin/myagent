import type { ToolDisplay } from "../session/tool-display.js";

export type ModelEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "assistant_raw"; value: unknown }
  | { type: "stop"; reason: "end_turn" | "tool_use" | "length" };

export type MessageToolCall = {
  id: string;
  name: string;
  input: unknown;
  display?: ToolDisplay;
};

export type Message = {
  role: "user" | "assistant" | "tool_result" | "summary";
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: MessageToolCall[];
  toolDisplay?: ToolDisplay;
  checkpointId?: string;
  providerRaw?: unknown;
};

export type ToolSchema = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ProviderKind = "openai" | "anthropic";

export type ProviderConfig = {
  provider: ProviderKind;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  authToken?: string;
  maxOutputTokens?: number;
};
