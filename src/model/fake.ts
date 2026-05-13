import type { Provider } from "./provider.js";
import type { ProviderStreamOptions } from "./provider.js";
import type { ModelEvent, Message } from "./types.js";

export class FakeProvider implements Provider {
  readonly name = "fake";
  private callIndex = 0;

  constructor(private eventSets: ModelEvent[][]) {}

  async *stream(
    messages: Message[],
    _tools?: import("./types.js").ToolSchema[],
    _options?: ProviderStreamOptions,
  ): AsyncGenerator<ModelEvent> {
    const events = this.eventSets[this.callIndex] ?? this.defaultEvents(messages);
    this.callIndex++;
    yield* events;
  }

  reset(): void {
    this.callIndex = 0;
  }

  private defaultEvents(messages: Message[]): ModelEvent[] {
    const lastUser = messages.findLast((m) => m.role === "user");
    const summary = messages.findLast((m) => m.role === "summary");
    if (!lastUser) return [{ type: "finish", reason: "stop" }];
    if (summary) {
      return [
        {
          type: "text",
          delta: `Received task: ${lastUser.content} with summary: ${summary.content}`,
        },
        { type: "finish", reason: "stop" },
      ];
    }
    return [
      { type: "text", delta: `Received task: ${lastUser.content}` },
      { type: "finish", reason: "stop" },
    ];
  }
}
