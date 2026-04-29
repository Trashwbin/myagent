import type { Provider } from "./provider.js";
import type { ModelEvent, Message, ProviderConfig } from "./types.js";

export class AnthropicCompatibleProvider implements Provider {
  readonly name = "anthropic";

  constructor(private _config: ProviderConfig) {}

  async *stream(_messages: Message[]): AsyncGenerator<ModelEvent> {
    // TODO: implement with @anthropic-ai/sdk
    // - convert Message[] to Anthropic Messages format
    // - stream events, translate content_block_delta/tool_use to ModelEvent
    throw new Error("Anthropic-compatible provider not yet implemented");
  }
}
