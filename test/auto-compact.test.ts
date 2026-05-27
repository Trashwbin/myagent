import { describe, expect, it } from "vitest";
import { decideAutoCompact, usableContextWindow } from "../src/session/auto-compact.js";
import type { SessionState } from "../src/session/loop.js";

function session(messages: SessionState["messages"]): SessionState {
  return {
    id: "s1",
    cwd: "/tmp/ws",
    messages,
  };
}

describe("auto compact policy", () => {
  it("uses context window minus reserved output as the usable limit", () => {
    expect(usableContextWindow({ contextWindow: 100_000, maxOutputTokens: 32_000 })).toBe(
      80_000,
    );
    expect(usableContextWindow({ contextWindow: 100_000, maxOutputTokens: 8_000 })).toBe(
      92_000,
    );
  });

  it("does not compact when context window or usage is unavailable", () => {
    const decision = decideAutoCompact({
      session: session([]),
      profile: {},
      now: 1,
    });

    expect(decision).toMatchObject({
      shouldCompact: false,
      usage: { source: "unknown" },
    });
  });

  it("requests compaction when provider usage reaches usable context", () => {
    const decision = decideAutoCompact({
      session: session([
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "hello",
          usage: { totalTokens: 92_000 },
        },
      ]),
      profile: { contextWindow: 100_000, maxOutputTokens: 8_000 },
      now: 1,
    });

    expect(decision).toMatchObject({
      shouldCompact: true,
      reason: "context_limit",
      usableContext: 92_000,
      usage: {
        source: "provider",
        usedTokens: 92_000,
        percentFull: 92,
      },
    });
  });

  it("uses compaction afterTokens and ignores stale retained assistant usage", () => {
    const decision = decideAutoCompact({
      session: session([
        {
          role: "summary",
          content: "summary",
          parts: [
            {
              type: "compaction",
              summary: "summary",
              compactedCount: 4,
              retainedCount: 2,
              afterTokens: 10_000,
            },
          ],
        },
        { role: "user", content: "recent" },
        {
          role: "assistant",
          content: "old retained answer",
          usage: { totalTokens: 98_000 },
        },
      ]),
      profile: { contextWindow: 100_000, maxOutputTokens: 8_000 },
      now: 1,
    });

    expect(decision).toMatchObject({
      shouldCompact: false,
      usage: {
        usedTokens: 10_000,
      },
    });
  });
});
