import React from "react";
import type { TimelineUserMessage } from "../../state/types.js";

export function UserMessage({ message }: { message: TimelineUserMessage }) {
  if (!message.text.trim()) return null;
  return (
    <div className="message user">
      <div className="content">{message.text}</div>
    </div>
  );
}
