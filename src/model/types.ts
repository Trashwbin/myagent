import type { ToolDisplay } from "../session/tool-display.js";

export type ProviderMetadata = Record<string, unknown>;

export type ModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  providerMetadata?: ProviderMetadata;
};

export type SessionContextUsageSource = "provider" | "estimate" | "unknown";

export type SessionContextUsage = {
  contextWindow?: number;
  lastUsage?: ModelUsage;
  totalUsage?: ModelUsage;
  usedTokens?: number;
  remainingTokens?: number;
  percentFull?: number;
  source: SessionContextUsageSource;
  updatedAt?: number;
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

export type MessagePhase = "commentary" | "final";

export type MessageLifecycleStatus =
  | "running"
  | "completed"
  | "failed"
  | "interrupted";

export type MessagePart =
  | {
      type: "text";
      text: string;
      phase?: MessagePhase;
      status?: MessageLifecycleStatus;
      providerMetadata?: ProviderMetadata;
    }
  | {
      type: "reasoning";
      text: string;
      phase?: MessagePhase;
      status?: MessageLifecycleStatus;
      providerMetadata?: ProviderMetadata;
    }
  | {
      type: "tool-call";
      id: string;
      name: string;
      input: unknown;
      display?: ToolDisplay;
      status?: MessageLifecycleStatus;
      providerMetadata?: ProviderMetadata;
    }
  | {
      type: "tool-result";
      id: string;
      name: string;
      result: unknown;
      isError?: boolean;
      display?: ToolDisplay;
      status?: MessageLifecycleStatus;
      providerMetadata?: ProviderMetadata;
    }
  | {
      type: "compaction";
      summary: string;
      compactedCount?: number;
      retainedCount?: number;
      previousSummaryUsed?: boolean;
      transcriptTruncated?: boolean;
      beforeTokens?: number;
      afterTokens?: number;
      createdAt?: number;
      status?: MessageLifecycleStatus;
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
  status?: MessageLifecycleStatus;
  error?: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: MessageToolCall[];
  toolDisplay?: ToolDisplay;
  checkpointId?: string;
  parts?: MessagePart[];
  usage?: ModelUsage;
  providerMetadata?: ProviderMetadata;
  providerRaw?: unknown;
};

export type ToolSchema = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ProviderKind = "openai" | "anthropic";

export type ProviderAdapter =
  | "@ai-sdk/openai"
  | "@ai-sdk/openai-compatible"
  | "@ai-sdk/anthropic";

export type ProviderMode = "chat" | "responses" | "messages";

export type ProviderConfig = {
  provider: ProviderKind;
  adapter?: ProviderAdapter;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  authToken?: string;
  maxOutputTokens?: number;
  mode?: ProviderMode;
  options?: Record<string, unknown>;
};
