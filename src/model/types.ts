export type ModelEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "stop"; reason: "end_turn" | "tool_use" | "length" };

export type Message = {
  role: "user" | "assistant" | "tool_result";
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: Array<{ id: string; name: string; input: unknown }>;
};

export type ProviderKind = "openai" | "anthropic";

export type ProviderConfig = {
  provider: ProviderKind;
  model: string;
  baseUrl?: string;
  apiKey?: string;
};
