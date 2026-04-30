import type { Provider } from "./provider.js";
import type { ProviderStreamOptions } from "./provider.js";
import type { ModelEvent, Message } from "./types.js";

export class FakeProvider implements Provider {
  readonly name = "fake";
  private callIndex = 0;

  constructor(private eventSets: ModelEvent[][]) {}

  async *stream(
    _messages: Message[],
    _tools?: import("./types.js").ToolSchema[],
    _options?: ProviderStreamOptions,
  ): AsyncGenerator<ModelEvent> {
    const events = this.eventSets[this.callIndex] ?? [
      { type: "stop", reason: "end_turn" as const },
    ];
    this.callIndex++;
    yield* events;
  }

  reset(): void {
    this.callIndex = 0;
  }
}
