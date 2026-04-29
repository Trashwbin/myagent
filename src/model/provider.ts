import type { ModelEvent, Message, ToolSchema } from "./types.js";

export interface Provider {
  readonly name: string;
  stream(messages: Message[], tools?: ToolSchema[]): AsyncGenerator<ModelEvent>;
}
