import React from "react";
import type { TimelinePart, TimelineTurn } from "../../state/types.js";
import { TurnDiffReview } from "../review/TurnDiffReview.js";
import { AssistantParts } from "./AssistantParts.js";
import { TurnToolTrace } from "./parts/TurnToolTrace.js";
import { UserMessage } from "./UserMessage.js";

export function splitTurnAssistantParts(parts: TimelinePart[]): {
  traceParts: TimelinePart[];
  finalParts: TimelinePart[];
} {
  const lastToolIndex = parts.findLastIndex((part) => part.kind === "tool");
  if (lastToolIndex < 0) {
    return {
      traceParts: [],
      finalParts: parts.filter((part) => part.kind !== "tool"),
    };
  }

  const traceParts: TimelinePart[] = [];
  const finalParts: TimelinePart[] = [];

  parts.forEach((part, index) => {
    if (part.kind === "text" && index > lastToolIndex) {
      finalParts.push(part);
      return;
    }
    traceParts.push(part);
  });

  return { traceParts, finalParts };
}

export function SessionTurn({ turn }: { turn: TimelineTurn }) {
  const { traceParts, finalParts } = splitTurnAssistantParts(turn.assistantParts);
  return (
    <article className="turn">
      <UserMessage message={turn.userMessage} />
      <TurnToolTrace turn={turn} parts={traceParts} />
      <AssistantParts parts={finalParts} />
      {turn.mutationDiffs.length > 0 ? (
        <TurnDiffReview files={turn.mutationDiffs} />
      ) : null}
    </article>
  );
}
