import { describe, expect, it } from "vitest";
import type { Provider } from "../src/model/provider.js";
import type { ModelEvent, Message, ToolSchema } from "../src/model/types.js";
import {
  compactSession,
  findTailStartIndex,
  selectCompactionMessages,
} from "../src/session/compact.js";
import type { SessionState } from "../src/session/loop.js";

class CapturingProvider implements Provider {
  readonly name = "capture";
  calls: Array<{
    messages: Message[];
    tools?: ToolSchema[];
    systemPrompt?: string;
  }> = [];

  constructor(private events: ModelEvent[]) {}

  async *stream(
    messages: Message[],
    tools?: ToolSchema[],
    options?: { systemPrompt?: string },
  ): AsyncGenerator<ModelEvent> {
    this.calls.push({ messages, tools, systemPrompt: options?.systemPrompt });
    yield* this.events;
  }
}

describe("compactSession", () => {
  it("replaces old transcript with a summary and retains the latest two user turns by default", async () => {
    const provider = new CapturingProvider([
      { type: "text", delta: "User wants the bug fixed. " },
      { type: "text", delta: "Checkpoint cp1 can restore auth.ts." },
      { type: "finish", reason: "stop" },
    ]);
    const session = makeSession([
      { role: "user", content: "fix auth bug" },
      { role: "assistant", content: "I edited auth.ts" },
      {
        role: "tool_result",
        toolCallId: "tc1",
        toolName: "edit_file",
        content: "Edited auth.ts",
        checkpointId: "cp1",
      },
      { role: "user", content: "now add tests" },
      { role: "assistant", content: "I'll add tests next" },
      { role: "user", content: "then run tests" },
      { role: "assistant", content: "I'll run them after editing" },
    ]);

    const result = await compactSession(provider, session);

    expect(result.compactedCount).toBe(3);
    expect(result.retainedCount).toBe(4);
    expect(result.previousSummaryUsed).toBe(false);
    expect(result.transcriptTruncated).toBe(false);
    expect(result.beforeTokens).toBeGreaterThan(result.afterTokens);
    expect(result.messages).toEqual([
      expect.objectContaining({
        role: "summary",
        content: "User wants the bug fixed. Checkpoint cp1 can restore auth.ts.",
        parts: [
          expect.objectContaining({
            type: "compaction",
            summary: "User wants the bug fixed. Checkpoint cp1 can restore auth.ts.",
            compactedCount: 3,
            retainedCount: 4,
            previousSummaryUsed: false,
            transcriptTruncated: false,
          }),
        ],
        providerMetadata: expect.objectContaining({
          compaction: expect.objectContaining({
            compactedCount: 3,
            retainedCount: 4,
            previousSummaryUsed: false,
            transcriptTruncated: false,
            beforeTokens: result.beforeTokens,
            afterTokens: result.afterTokens,
          }),
        }),
      }),
      { role: "user", content: "now add tests" },
      { role: "assistant", content: "I'll add tests next" },
      { role: "user", content: "then run tests" },
      { role: "assistant", content: "I'll run them after editing" },
    ]);
    expect(session.messages).toHaveLength(7);
    expect(provider.calls[0]?.tools).toBeUndefined();
    expect(provider.calls[0]?.systemPrompt).toContain("compact agent transcripts");
    expect(provider.calls[0]?.messages[0]?.content).toContain("checkpointId=cp1");
    expect(provider.calls[0]?.messages[0]?.content).toContain("## Critical Context");
  });

  it("keeps the requested number of latest user turns", () => {
    const messages: Message[] = [
      { role: "user", content: "one" },
      { role: "assistant", content: "a" },
      { role: "user", content: "two" },
      { role: "assistant", content: "b" },
      { role: "user", content: "three" },
    ];

    expect(findTailStartIndex(messages, 2)).toBe(2);
  });

  it("does not compact when there is no older transcript", async () => {
    const provider = new CapturingProvider([
      { type: "text", delta: "unused" },
      { type: "finish", reason: "stop" },
    ]);

    await expect(
      compactSession(provider, makeSession([{ role: "user", content: "only turn" }])),
    ).rejects.toThrow("Not enough transcript history");
    expect(provider.calls).toHaveLength(0);
  });

  it("uses the previous summary as an anchor without duplicating it into the transcript", async () => {
    const provider = new CapturingProvider([
      { type: "text", delta: "Updated summary" },
      { type: "finish", reason: "stop" },
    ]);

    const result = await compactSession(
      provider,
      makeSession([
        { role: "summary", content: "Earlier summary with cp-old." },
        { role: "user", content: "old follow-up" },
        { role: "assistant", content: "old answer" },
        { role: "user", content: "recent one" },
        { role: "assistant", content: "recent answer" },
        { role: "user", content: "recent two" },
      ]),
    );

    expect(result.previousSummaryUsed).toBe(true);
    expect(result.messages[0]).toMatchObject({
      role: "summary",
      content: "Updated summary",
      providerMetadata: {
        compaction: expect.objectContaining({ previousSummaryUsed: true }),
      },
    });
    const prompt = provider.calls[0]?.messages[0]?.content ?? "";
    expect(prompt).toContain(
      "<previous-summary>\nEarlier summary with cp-old.\n</previous-summary>",
    );
    expect(prompt).not.toContain("role=summary");
    expect(prompt).toContain("role=user\nold follow-up");
  });

  it("truncates large tool outputs and redacts likely secrets before summarizing", async () => {
    const provider = new CapturingProvider([
      { type: "text", delta: "Summary" },
      { type: "finish", reason: "stop" },
    ]);
    const oversized = `${"x".repeat(100)}\napi_key=sk-secret-value\n${"y".repeat(1_700)}`;

    const result = await compactSession(
      provider,
      makeSession([
        { role: "user", content: "inspect logs" },
        {
          role: "tool_result",
          toolName: "bash",
          toolCallId: "tc1",
          content: oversized,
        },
        { role: "user", content: "recent one" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "recent two" },
      ]),
      { maxToolOutputChars: 600 },
    );

    const prompt = provider.calls[0]?.messages[0]?.content ?? "";
    expect(result.transcriptTruncated).toBe(false);
    expect(prompt).toContain("[tool output truncated]");
    expect(prompt).toContain("api_key=[redacted]");
    expect(prompt).not.toContain("sk-secret-value");
    expect(prompt).not.toContain("y".repeat(700));
  });

  it("can move the retained tail forward when recent turns exceed the preserve budget", () => {
    const big = "z".repeat(1_200);
    const messages: Message[] = [
      { role: "user", content: "one" },
      { role: "assistant", content: big },
      { role: "user", content: "two" },
      { role: "assistant", content: big },
      { role: "user", content: "three" },
      { role: "assistant", content: big },
      { role: "user", content: "four" },
    ];

    const selected = selectCompactionMessages(messages, {
      retainUserTurns: 3,
      preserveRecentChars: 1_000,
    });

    expect(selected.tailStartIndex).toBe(6);
    expect(selected.retained).toEqual([{ role: "user", content: "four" }]);
  });

  it("rejects tool calls during compaction", async () => {
    const provider = new CapturingProvider([
      { type: "tool-call", id: "tc1", name: "Read", input: { path: "a.txt" } },
    ]);

    await expect(
      compactSession(
        provider,
        makeSession([
          { role: "user", content: "old" },
          { role: "assistant", content: "old answer" },
          { role: "user", content: "new" },
        ]),
        { retainUserTurns: 1 },
      ),
    ).rejects.toThrow("unsupported tool call");
  });
});

function makeSession(messages: Message[]): SessionState {
  return {
    id: "s1",
    cwd: "/tmp/project",
    messages,
  };
}
