import type { Message, ModelUsage, SessionContextUsage } from "../model/types.js";

export function usageTokenCount(usage: ModelUsage | undefined): number | undefined {
  if (!usage) return undefined;
  if (isPositiveNumber(usage.totalTokens)) return usage.totalTokens;
  const total =
    positiveOrZero(usage.inputTokens) +
    positiveOrZero(usage.outputTokens) +
    positiveOrZero(usage.reasoningTokens);
  return total > 0 ? total : undefined;
}

export function deriveSessionContextUsage(input: {
  messages: Message[];
  contextWindow?: number;
  latestUsage?: ModelUsage;
  now?: number;
}): SessionContextUsage {
  const compaction = latestCompactionInfo(input.messages);
  const compactedBaseline = compaction?.afterTokens;
  const messagesAfterCompaction = compaction
    ? messagesAfterLatestCompaction(input.messages, compaction)
    : input.messages;
  const providerUsages = messagesAfterCompaction
    .filter((message) => message.role === "assistant" && message.usage)
    .map((message) => message.usage!)
    .filter((usage) => usageTokenCount(usage) !== undefined);
  const latestProviderUsage =
    input.latestUsage && usageTokenCount(input.latestUsage) !== undefined
      ? input.latestUsage
      : providerUsages[providerUsages.length - 1];
  const totalUsage = sumUsages(providerUsages);
  const providerUsedTokens = usageTokenCount(latestProviderUsage);

  if (providerUsedTokens !== undefined) {
    const usedTokens = compactedBaseline
      ? compactedBaseline + providerUsedTokens
      : providerUsedTokens;
    return withDerivedWindowFields({
      contextWindow: input.contextWindow,
      lastUsage: latestProviderUsage,
      totalUsage,
      usedTokens,
      source: "provider",
      updatedAt: input.now ?? Date.now(),
    });
  }

  if (compactedBaseline) {
    const estimatedTailTokens = estimateMessagesTokens(messagesAfterCompaction);
    return withDerivedWindowFields({
      contextWindow: input.contextWindow,
      totalUsage,
      usedTokens: compactedBaseline + estimatedTailTokens,
      source: "estimate",
      updatedAt: input.now ?? Date.now(),
    });
  }

  const estimatedTokens = estimateMessagesTokens(input.messages);
  if (estimatedTokens > 0) {
    return withDerivedWindowFields({
      contextWindow: input.contextWindow,
      totalUsage,
      usedTokens: estimatedTokens,
      source: "estimate",
      updatedAt: input.now ?? Date.now(),
    });
  }

  return withDerivedWindowFields({
    contextWindow: input.contextWindow,
    totalUsage,
    source: "unknown",
    updatedAt: input.now ?? Date.now(),
  });
}

export function estimateMessagesTokens(messages: Message[]): number {
  const chars = messages.reduce((total, message) => {
    return total + messageTextForEstimate(message).length;
  }, 0);
  return Math.ceil(chars / 4);
}

type CompactionInfo = {
  index: number;
  afterTokens: number;
  retainedCount: number;
};

function latestCompactionInfo(messages: Message[]): CompactionInfo | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message || message.role !== "summary") continue;
    const part = message.parts?.find((candidate) => candidate.type === "compaction");
    if (part?.type === "compaction" && isPositiveNumber(part.afterTokens)) {
      return {
        index,
        afterTokens: part.afterTokens,
        retainedCount: positiveIntegerOrZero(part.retainedCount),
      };
    }
    const metadata = isRecord(message.providerMetadata?.compaction)
      ? message.providerMetadata.compaction
      : undefined;
    if (isPositiveNumber(metadata?.afterTokens)) {
      return {
        index,
        afterTokens: metadata.afterTokens,
        retainedCount: positiveIntegerOrZero(metadata.retainedCount),
      };
    }
    const estimate = estimateMessagesTokens([message]);
    return estimate > 0 ? { index, afterTokens: estimate, retainedCount: 0 } : undefined;
  }
  return undefined;
}

function messagesAfterLatestCompaction(
  messages: Message[],
  info: CompactionInfo,
): Message[] {
  return messages.slice(info.index + 1 + info.retainedCount);
}

function withDerivedWindowFields(usage: SessionContextUsage): SessionContextUsage {
  if (!usage.contextWindow || usage.usedTokens === undefined) return usage;
  const percentFull = Math.min(
    100,
    Math.max(0, Math.round((usage.usedTokens / usage.contextWindow) * 100)),
  );
  return {
    ...usage,
    remainingTokens: Math.max(0, usage.contextWindow - usage.usedTokens),
    percentFull,
  };
}

function sumUsages(usages: ModelUsage[]): ModelUsage | undefined {
  if (usages.length === 0) return undefined;
  const total = usages.reduce<{
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
  }>(
    (sum, usage) => ({
      inputTokens: sum.inputTokens + positiveOrZero(usage.inputTokens),
      outputTokens: sum.outputTokens + positiveOrZero(usage.outputTokens),
      reasoningTokens: sum.reasoningTokens + positiveOrZero(usage.reasoningTokens),
      totalTokens: sum.totalTokens + positiveOrZero(usage.totalTokens),
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
    },
  );
  return {
    ...(total.inputTokens > 0 ? { inputTokens: total.inputTokens } : {}),
    ...(total.outputTokens > 0 ? { outputTokens: total.outputTokens } : {}),
    ...(total.reasoningTokens > 0 ? { reasoningTokens: total.reasoningTokens } : {}),
    ...(total.totalTokens > 0 ? { totalTokens: total.totalTokens } : {}),
  };
}

function messageTextForEstimate(message: Message): string {
  const parts = message.parts?.map((part) => {
    if (part.type === "text" || part.type === "reasoning") return part.text;
    if (part.type === "tool-call") return `${part.name} ${JSON.stringify(part.input)}`;
    if (part.type === "tool-result") return `${part.name} ${JSON.stringify(part.result)}`;
    if (part.type === "compaction") return part.summary;
    return "";
  });
  return [
    message.role,
    message.content,
    message.toolCalls ? JSON.stringify(message.toolCalls) : "",
    parts?.join("\n") ?? "",
  ].join("\n");
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function positiveOrZero(value: unknown): number {
  return isPositiveNumber(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveIntegerOrZero(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}
