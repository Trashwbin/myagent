import type { Provider } from "./provider.js";
import type { ModelEvent, Message, ProviderConfig } from "./types.js";

export class OpenAICompatibleProvider implements Provider {
  readonly name = "openai";

  constructor(private _config: ProviderConfig) {}

  async *stream(_messages: Message[]): AsyncGenerator<ModelEvent> {
    // TODO: implement with openai SDK
    // - convert Message[] to OpenAI chat format
    // - stream chunks, translate deltas to ModelEvent
    throw new Error("OpenAI-compatible provider not yet implemented");
  }
}
