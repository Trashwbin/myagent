import type { ModelEvent, Message, ToolSchema } from "./types.js";

export type ProviderStreamOptions = {
  systemPrompt?: string;
};

export interface Provider {
  readonly name: string;
  stream(
    messages: Message[],
    tools?: ToolSchema[],
    options?: ProviderStreamOptions,
  ): AsyncGenerator<ModelEvent>;
}
