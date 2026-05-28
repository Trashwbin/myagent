import type { Message } from "../model/types.js";

export type ToolResultMessage = Message & { role: "tool_result" };

export function isToolResultMessage(message: Message): message is ToolResultMessage {
  return message.role === "tool_result";
}

export type { Message };
