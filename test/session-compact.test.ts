import { describe, expect, it } from "vitest";
import type { Provider } from "../src/model/provider.js";
import type { ModelEvent, Message, ToolSchema } from "../src/model/types.js";
import {
  compactSession,
  findTailStartIndex,
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
  it("replaces old transcript with a summary and retained latest user turn", async () => {
    const provider = new CapturingProvider([
      { type: "text_delta", text: "User wants the bug fixed. " },
      { type: "text_delta", text: "Checkpoint cp1 can restore auth.ts." },
      { type: "stop", reason: "end_turn" },
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
    ]);

    const result = await compactSession(provider, session);

    expect(result.compactedCount).toBe(3);
    expect(result.retainedCount).toBe(2);
    expect(result.messages).toEqual([
      {
        role: "summary",
        content: "User wants the bug fixed. Checkpoint cp1 can restore auth.ts.",
      },
      { role: "user", content: "now add tests" },
      { role: "assistant", content: "I'll add tests next" },
    ]);
    expect(session.messages).toHaveLength(5);
    expect(provider.calls[0]?.tools).toBeUndefined();
    expect(provider.calls[0]?.systemPrompt).toContain("compact agent transcripts");
    expect(provider.calls[0]?.messages[0]?.content).toContain("checkpointId=cp1");
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
      { type: "text_delta", text: "unused" },
      { type: "stop", reason: "end_turn" },
    ]);

    await expect(
      compactSession(provider, makeSession([{ role: "user", content: "only turn" }])),
    ).rejects.toThrow("Not enough transcript history");
    expect(provider.calls).toHaveLength(0);
  });

  it("rejects tool calls during compaction", async () => {
    const provider = new CapturingProvider([
      { type: "tool_call", id: "tc1", name: "Read", input: { path: "a.txt" } },
    ]);

    await expect(
      compactSession(
        provider,
        makeSession([
          { role: "user", content: "old" },
          { role: "assistant", content: "old answer" },
          { role: "user", content: "new" },
        ]),
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
