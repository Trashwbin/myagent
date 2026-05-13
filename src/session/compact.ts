import type { Provider } from "../model/provider.js";
import type { Message } from "../model/types.js";
import type { SessionState } from "./loop.js";

export type CompactOptions = {
  retainUserTurns?: number;
  maxTranscriptChars?: number;
};

export type CompactResult = {
  summary: string;
  messages: Message[];
  compactedCount: number;
  retainedCount: number;
};

const DEFAULT_RETAIN_USER_TURNS = 1;
const DEFAULT_MAX_TRANSCRIPT_CHARS = 60_000;
const MAX_MESSAGE_CHARS = 4_000;

export async function compactSession(
  provider: Provider,
  session: SessionState,
  options?: CompactOptions,
): Promise<CompactResult> {
  const retainUserTurns = Math.max(1, options?.retainUserTurns ?? DEFAULT_RETAIN_USER_TURNS);
  const splitIndex = findTailStartIndex(session.messages, retainUserTurns);
  if (splitIndex <= 0) {
    throw new Error("Not enough transcript history to compact");
  }

  const compacted = session.messages.slice(0, splitIndex);
  const retained = session.messages.slice(splitIndex);
  const prompt = buildCompactPrompt(
    compacted,
    options?.maxTranscriptChars ?? DEFAULT_MAX_TRANSCRIPT_CHARS,
  );
  const summary = await generateSummary(provider, prompt);
  const summaryMessage: Message = {
    role: "summary",
    content: summary,
  };

  return {
    summary,
    messages: [summaryMessage, ...retained],
    compactedCount: compacted.length,
    retainedCount: retained.length,
  };
}

export function findTailStartIndex(
  messages: Message[],
  retainUserTurns = DEFAULT_RETAIN_USER_TURNS,
): number {
  let remaining = Math.max(1, retainUserTurns);
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      remaining--;
      if (remaining === 0) return i;
    }
  }
  return 0;
}

async function generateSummary(provider: Provider, prompt: string): Promise<string> {
  let summary = "";
  for await (const event of provider.stream(
    [{ role: "user", content: prompt }],
    undefined,
    { systemPrompt: COMPACT_SYSTEM_PROMPT },
  )) {
    if (event.type === "text") {
      summary += event.delta;
    } else if (event.type === "tool-call") {
      throw new Error("Compaction provider attempted an unsupported tool call");
    }
  }

  const trimmed = summary.trim();
  if (!trimmed) throw new Error("Compaction provider returned an empty summary");
  return trimmed;
}

function buildCompactPrompt(messages: Message[], maxTranscriptChars: number): string {
  return [
    "Compact the following agent transcript into a continuation summary.",
    "",
    "The summary must include:",
    "- user goals and constraints",
    "- completed changes and important files",
    "- key decisions and assumptions",
    "- pending work, errors, and test status",
    "- checkpoint ids that may be needed for recovery",
    "",
    "Do not preserve large tool outputs or secret values verbatim. Keep the result concise but sufficient to continue the same session.",
    "",
    "<transcript>",
    serializeTranscript(messages, maxTranscriptChars),
    "</transcript>",
  ].join("\n");
}

function serializeTranscript(messages: Message[], maxChars: number): string {
  const lines: string[] = [];
  let used = 0;

  for (const [index, message] of messages.entries()) {
    const rendered = renderMessage(index, message);
    const remaining = maxChars - used;
    if (remaining <= 0) {
      lines.push("[transcript truncated]");
      break;
    }
    const chunk = rendered.length > remaining
      ? `${rendered.slice(0, Math.max(0, remaining - 25))}\n[message truncated]`
      : rendered;
    lines.push(chunk);
    used += chunk.length;
  }

  return lines.join("\n\n");
}

function renderMessage(index: number, message: Message): string {
  const labels = [`#${index + 1}`, `role=${message.role}`];
  if (message.toolName) labels.push(`tool=${message.toolName}`);
  if (message.toolCallId) labels.push(`toolCallId=${message.toolCallId}`);
  if (message.checkpointId) labels.push(`checkpointId=${message.checkpointId}`);
  if (message.toolCalls?.length) {
    labels.push(
      `toolCalls=${message.toolCalls
        .map((toolCall) => `${toolCall.name}:${toolCall.id}`)
        .join(",")}`,
    );
  }
  return `${labels.join(" ")}\n${truncateMessageContent(message.content)}`;
}

function truncateMessageContent(content: string): string {
  if (content.length <= MAX_MESSAGE_CHARS) return content;
  return `${content.slice(0, MAX_MESSAGE_CHARS)}\n[message truncated]`;
}

const COMPACT_SYSTEM_PROMPT = [
  "You compact agent transcripts into a continuation summary.",
  "Write only the summary content.",
  "Do not claim to be summarizing.",
  "Do not include secrets or large raw tool outputs verbatim.",
].join("\n");
