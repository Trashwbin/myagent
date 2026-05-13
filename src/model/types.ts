import type { ToolDisplay } from "../session/tool-display.js";

export type ProviderMetadata = Record<string, unknown>;

export type ModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  providerMetadata?: ProviderMetadata;
};

export type ModelFinishReason = "stop" | "tool-calls" | "length" | "error";

export type CanonicalModelEvent =
  | { type: "start" }
  | {
      type: "step-start";
      providerMetadata?: ProviderMetadata;
    }
  | {
      type: "step-finish";
      reason: ModelFinishReason;
      usage?: ModelUsage;
      providerMetadata?: ProviderMetadata;
    }
  | {
      type: "text-start";
      id: string;
      providerMetadata?: ProviderMetadata;
    }
  | {
      type: "text-end";
      id: string;
      providerMetadata?: ProviderMetadata;
    }
  | {
      type: "reasoning-start";
      id: string;
      providerMetadata?: ProviderMetadata;
    }
  | {
      type: "reasoning-end";
      id: string;
      providerMetadata?: ProviderMetadata;
    }
  | { type: "text"; id?: string; delta: string; providerMetadata?: ProviderMetadata }
  | {
      type: "reasoning";
      id?: string;
      delta: string;
      providerMetadata?: ProviderMetadata;
    }
  | {
      type: "tool-call";
      id: string;
      name: string;
      input: unknown;
      providerMetadata?: ProviderMetadata;
    }
  | {
      type: "tool-result";
      id: string;
      name: string;
      result: unknown;
      isError?: boolean;
      providerMetadata?: ProviderMetadata;
    }
  | {
      type: "finish";
      reason: ModelFinishReason;
      usage?: ModelUsage;
      providerMetadata?: ProviderMetadata;
    }
  | { type: "abort"; reason?: string };

export type ModelEvent = CanonicalModelEvent;

export type MessagePart =
  | { type: "text"; text: string; providerMetadata?: ProviderMetadata }
  | { type: "reasoning"; text: string; providerMetadata?: ProviderMetadata }
  | {
      type: "tool-call";
      id: string;
      name: string;
      input: unknown;
      display?: ToolDisplay;
      providerMetadata?: ProviderMetadata;
    }
  | {
      type: "tool-result";
      id: string;
      name: string;
      result: unknown;
      isError?: boolean;
      display?: ToolDisplay;
      providerMetadata?: ProviderMetadata;
    };

export type MessageToolCall = {
  id: string;
  name: string;
  input: unknown;
  display?: ToolDisplay;
  providerMetadata?: ProviderMetadata;
};

export type Message = {
  role: "user" | "assistant" | "tool_result" | "summary";
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: MessageToolCall[];
  toolDisplay?: ToolDisplay;
  checkpointId?: string;
  parts?: MessagePart[];
  providerMetadata?: ProviderMetadata;
  providerRaw?: unknown;
};

export type ToolSchema = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ProviderKind = "openai" | "anthropic";

export type ProviderProtocol = "chat" | "responses" | "messages";

export type ProviderConfig = {
  provider: ProviderKind;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  authToken?: string;
  maxOutputTokens?: number;
  protocol?: ProviderProtocol;
};
