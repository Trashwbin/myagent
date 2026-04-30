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
    if (!lastUser) return [{ type: "stop", reason: "end_turn" }];
    return [
      { type: "text_delta", text: `Received task: ${lastUser.content}` },
      { type: "stop", reason: "end_turn" },
    ];
  }
}
