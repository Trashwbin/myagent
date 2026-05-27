import type { ModelProfile } from "../config/config.js";
import type { SessionContextUsage } from "../model/types.js";
import { deriveSessionContextUsage } from "./context-usage.js";
import type { SessionState } from "./loop.js";

const DEFAULT_COMPACTION_BUFFER = 20_000;

export type AutoCompactDecision =
  | {
      shouldCompact: false;
      usage: SessionContextUsage;
      usableContext?: number;
    }
  | {
      shouldCompact: true;
      usage: SessionContextUsage;
      usableContext: number;
      reason: "context_limit";
    };

export function decideAutoCompact(input: {
  session: SessionState;
  profile?: Pick<ModelProfile, "contextWindow" | "maxOutputTokens">;
  now?: number;
}): AutoCompactDecision {
  const contextWindow = input.profile?.contextWindow;
  const usage = deriveSessionContextUsage({
    messages: input.session.messages,
    contextWindow,
    now: input.now,
  });
  const usableContext = usableContextWindow(input.profile);
  if (!usableContext || usage.usedTokens === undefined) {
    return { shouldCompact: false, usage, usableContext };
  }
  if (usage.usedTokens < usableContext) {
    return { shouldCompact: false, usage, usableContext };
  }
  return {
    shouldCompact: true,
    usage,
    usableContext,
    reason: "context_limit",
  };
}

export function usableContextWindow(
  profile?: Pick<ModelProfile, "contextWindow" | "maxOutputTokens">,
): number | undefined {
  const contextWindow = profile?.contextWindow;
  if (!contextWindow) return undefined;
  const maxOutputTokens = profile.maxOutputTokens ?? 0;
  const reserved = Math.min(
    DEFAULT_COMPACTION_BUFFER,
    maxOutputTokens || DEFAULT_COMPACTION_BUFFER,
  );
  return Math.max(0, contextWindow - reserved);
}
