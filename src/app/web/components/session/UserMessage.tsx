import React from "react";
import type { TimelineUserMessage } from "../../state/types.js";

export function UserMessage({ message }: { message: TimelineUserMessage }) {
  return (
    <div className="message user">
      <div className="content">{message.text}</div>
    </div>
  );
}
