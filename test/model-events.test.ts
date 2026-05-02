import { describe, it, expect } from "vitest";
import { FakeProvider } from "../src/model/fake.js";
import type { ModelEvent, ProviderConfig } from "../src/model/types.js";

describe("ModelEvent / FakeProvider", () => {
  it("emits events in order", async () => {
    const events: ModelEvent[] = [
      { type: "text_delta", text: "Hello" },
      { type: "tool_call", id: "1", name: "Read", input: { path: "a.txt" } },
      { type: "stop", reason: "tool_use" },
    ];
    const provider = new FakeProvider([events]);

    const collected: ModelEvent[] = [];
    for await (const event of provider.stream([])) {
      collected.push(event);
    }

    expect(collected).toEqual(events);
  });

  it("emits default stop when no events configured", async () => {
    const provider = new FakeProvider([]);

    const collected: ModelEvent[] = [];
    for await (const event of provider.stream([])) {
      collected.push(event);
    }

    expect(collected).toEqual([{ type: "stop", reason: "end_turn" }]);
  });

  it("echoes latest user message when event sets are exhausted", async () => {
    const provider = new FakeProvider([]);

    const collected: ModelEvent[] = [];
    for await (const event of provider.stream([{ role: "user", content: "hello" }])) {
      collected.push(event);
    }

    expect(collected).toEqual([
      { type: "text_delta", text: "Received task: hello" },
      { type: "stop", reason: "end_turn" },
    ]);
  });

  it("supports multi-turn event sets", async () => {
    const provider = new FakeProvider([
      [
        { type: "text_delta", text: "turn 1" },
        { type: "stop", reason: "end_turn" },
      ],
      [
        { type: "text_delta", text: "turn 2" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const t1: ModelEvent[] = [];
    for await (const e of provider.stream([])) t1.push(e);
    expect(t1).toEqual([
      { type: "text_delta", text: "turn 1" },
      { type: "stop", reason: "end_turn" },
    ]);

    const t2: ModelEvent[] = [];
    for await (const e of provider.stream([])) t2.push(e);
    expect(t2).toEqual([
      { type: "text_delta", text: "turn 2" },
      { type: "stop", reason: "end_turn" },
    ]);
  });

  it("emits tool_call with input", async () => {
    const provider = new FakeProvider([
      [
        { type: "tool_call", id: "tc1", name: "bash", input: { command: "echo hi" } },
        { type: "stop", reason: "tool_use" },
      ],
    ]);

    const collected: ModelEvent[] = [];
    for await (const e of provider.stream([])) collected.push(e);

    expect(collected[0]).toEqual({
      type: "tool_call",
      id: "tc1",
      name: "bash",
      input: { command: "echo hi" },
    });
  });

  it("supports bearer auth token provider config", () => {
    const config: ProviderConfig = {
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      baseUrl: "https://example.test",
      authToken: "token",
    };

    expect(config.authToken).toBe("token");
  });
});
