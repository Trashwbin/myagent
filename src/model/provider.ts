import type { ModelEvent, Message } from "./types.js";

export interface Provider {
  readonly name: string;
  stream(messages: Message[]): AsyncGenerator<ModelEvent>;
}
