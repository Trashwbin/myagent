import type { Provider } from "../model/provider.js";
import type { Message } from "../model/types.js";
import type { SessionState } from "./loop.js";

export type CompactOptions = {
  retainUserTurns?: number;
  maxTranscriptChars?: number;
  preserveRecentChars?: number;
  maxMessageChars?: number;
  maxToolOutputChars?: number;
};

export type CompactResult = {
  summary: string;
  messages: Message[];
  compactedCount: number;
  retainedCount: number;
  previousSummaryUsed: boolean;
  transcriptTruncated: boolean;
};

type CompactConfig = Required<CompactOptions>;

type CompactSelection = {
  compacted: Message[];
  retained: Message[];
  previousSummary?: string;
  tailStartIndex: number;
};

type SerializedTranscript = {
  text: string;
  truncated: boolean;
};

type CompactPrompt = {
  text: string;
  truncated: boolean;
};

const DEFAULT_RETAIN_USER_TURNS = 2;
const DEFAULT_MAX_TRANSCRIPT_CHARS = 80_000;
const DEFAULT_PRESERVE_RECENT_CHARS = 24_000;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_TOOL_OUTPUT_CHARS = 2_000;
const TOOL_OUTPUT_PROTECTED_FROM_TIGHT_CAP = new Set(["skill"]);

export async function compactSession(
  provider: Provider,
  session: SessionState,
  options?: CompactOptions,
): Promise<CompactResult> {
  const config = normalizeOptions(options);
  const selection = selectCompactionMessages(session.messages, config);
  if (
    selection.tailStartIndex <= 0 ||
    selection.compacted.every((msg) => msg.role === "summary")
  ) {
    throw new Error("Not enough transcript history to compact");
  }

  const promptInput = buildCompactPrompt(selection, config);
  const summary = await generateSummary(provider, promptInput.text);
  const summaryMessage: Message = {
    role: "summary",
    content: summary,
    providerMetadata: {
      compaction: {
        compactedCount: selection.compacted.length,
        retainedCount: selection.retained.length,
        previousSummaryUsed: Boolean(selection.previousSummary),
        tailStartIndex: selection.tailStartIndex,
        transcriptTruncated: promptInput.truncated,
        createdAt: Date.now(),
      },
    },
  };

  return {
    summary,
    messages: [summaryMessage, ...selection.retained],
    compactedCount: selection.compacted.length,
    retainedCount: selection.retained.length,
    previousSummaryUsed: Boolean(selection.previousSummary),
    transcriptTruncated: promptInput.truncated,
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

export function selectCompactionMessages(
  messages: Message[],
  options?: CompactOptions,
): CompactSelection {
  const config = normalizeOptions(options);
  const initialTailStart = findTailStartIndex(messages, config.retainUserTurns);
  const tailStartIndex = enforceTailBudget(
    messages,
    initialTailStart,
    config.preserveRecentChars,
  );
  const compacted = messages.slice(0, tailStartIndex);
  const retained = messages.slice(tailStartIndex).filter((msg) => msg.role !== "summary");
  const previousSummary = compacted.findLast((msg) => msg.role === "summary")?.content;

  return {
    compacted,
    retained,
    previousSummary,
    tailStartIndex,
  };
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

function normalizeOptions(options?: CompactOptions): CompactConfig {
  return {
    retainUserTurns: Math.max(1, options?.retainUserTurns ?? DEFAULT_RETAIN_USER_TURNS),
    maxTranscriptChars: Math.max(
      1_000,
      options?.maxTranscriptChars ?? DEFAULT_MAX_TRANSCRIPT_CHARS,
    ),
    preserveRecentChars: Math.max(
      1_000,
      options?.preserveRecentChars ?? DEFAULT_PRESERVE_RECENT_CHARS,
    ),
    maxMessageChars: Math.max(500, options?.maxMessageChars ?? MAX_MESSAGE_CHARS),
    maxToolOutputChars: Math.max(
      200,
      options?.maxToolOutputChars ?? MAX_TOOL_OUTPUT_CHARS,
    ),
  };
}

function enforceTailBudget(
  messages: Message[],
  tailStartIndex: number,
  preserveRecentChars: number,
): number {
  let start = tailStartIndex;
  if (start <= 0) return start;

  while (estimateMessagesChars(messages.slice(start)) > preserveRecentChars) {
    const nextUser = messages.findIndex(
      (msg, index) => index > start && msg.role === "user",
    );
    if (nextUser < 0) break;
    start = nextUser;
  }

  return start;
}

function estimateMessagesChars(messages: Message[]): number {
  return messages.reduce((total, msg) => {
    const toolCalls = msg.toolCalls ? JSON.stringify(msg.toolCalls).length : 0;
    const display = msg.toolDisplay ? JSON.stringify(msg.toolDisplay).length : 0;
    return total + msg.content.length + toolCalls + display + 64;
  }, 0);
}

function buildCompactPrompt(
  selection: CompactSelection,
  config: CompactConfig,
): CompactPrompt {
  const transcript = serializeTranscript(selection.compacted, config);
  const anchor = selection.previousSummary
    ? [
        "Update the anchored summary below using the conversation history in <transcript>.",
        "Preserve still-true details, remove stale details, and merge in the new facts.",
        "",
        "<previous-summary>",
        selection.previousSummary,
        "</previous-summary>",
      ].join("\n")
    : "Create a new anchored summary from the conversation history in <transcript>.";
  const text = [
    anchor,
    "",
    "Output exactly this Markdown structure and keep the section order unchanged:",
    SUMMARY_TEMPLATE,
    "",
    "Rules:",
    "- Keep every section, even when empty.",
    "- Use terse bullets, not prose paragraphs.",
    "- Preserve exact file paths, commands, error strings, checkpoint ids, and test results when known.",
    "- Do not preserve large tool outputs or secret values verbatim.",
    "- Do not mention the summary process or that context was compacted.",
    "",
    "<transcript>",
    transcript.text,
    "</transcript>",
  ].join("\n");
  return {
    text,
    truncated: transcript.truncated,
  };
}

function serializeTranscript(
  messages: Message[],
  config: CompactConfig,
): SerializedTranscript {
  const lines: string[] = [];
  let used = 0;
  let truncated = false;

  for (const [index, message] of messages.entries()) {
    if (message.role === "summary") continue;
    const rendered = renderMessage(index, message, config);
    const remaining = config.maxTranscriptChars - used;
    if (remaining <= 0) {
      lines.push("[transcript truncated]");
      truncated = true;
      break;
    }
    const chunk =
      rendered.length > remaining
        ? `${rendered.slice(0, Math.max(0, remaining - 25))}\n[message truncated]`
        : rendered;
    if (chunk.length < rendered.length) truncated = true;
    lines.push(chunk);
    used += chunk.length;
  }

  return {
    text: lines.length ? lines.join("\n\n") : "(no new transcript messages)",
    truncated,
  };
}

function renderMessage(index: number, message: Message, config: CompactConfig): string {
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
  const display = renderDisplay(message);
  const content = truncateMessageContent(
    redactLikelySecrets(message.content),
    message.role === "tool_result" &&
      !TOOL_OUTPUT_PROTECTED_FROM_TIGHT_CAP.has(message.toolName ?? "")
      ? config.maxToolOutputChars
      : config.maxMessageChars,
    message.role === "tool_result" ? "tool output truncated" : "message truncated",
  );
  return [labels.join(" "), display, content].filter(Boolean).join("\n");
}

function renderDisplay(message: Message): string {
  const display = message.toolDisplay;
  if (!display) return "";
  const lines = [
    `display=${display.kind}:${display.title}`,
    display.subtitle ? `subtitle=${display.subtitle}` : "",
    display.summary ? `summary=${display.summary}` : "",
  ].filter(Boolean);
  for (const file of display.files ?? []) {
    lines.push(
      `file=${file.path} +${file.additions} -${file.deletions}${file.sensitive ? " sensitive" : ""}`,
    );
  }
  return lines.join("\n");
}

function truncateMessageContent(
  content: string,
  maxChars: number,
  marker: string,
): string {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n[${marker}]`;
}

function redactLikelySecrets(content: string): string {
  return content.replace(
    /\b(password|passwd|secret|token|api_?key|private_?key|auth_?key|database_?url)\b\s*([:=])\s*("[^"]+"|'[^']+'|[^\s]+)/gi,
    "$1$2[redacted]",
  );
}

const COMPACT_SYSTEM_PROMPT = [
  "You compact agent transcripts into a continuation summary.",
  "Write only the summary content.",
  "Do not claim to be summarizing.",
  "Do not include secrets or large raw tool outputs verbatim.",
].join("\n");

const SUMMARY_TEMPLATE = `## Goal
- [single-sentence task summary]

## Constraints & Preferences
- [user constraints, preferences, specs, or "(none)"]

## Progress
### Done
- [completed work or "(none)"]

### In Progress
- [current work or "(none)"]

### Blocked
- [blockers or "(none)"]

## Key Decisions
- [decision and why, or "(none)"]

## Next Steps
- [ordered next actions or "(none)"]

## Critical Context
- [important technical facts, errors, checkpoint ids, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]`;
