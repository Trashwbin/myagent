import React from "react";
import type { TimelineTurn } from "../../state/types.js";
import { TurnDiffReview } from "../review/TurnDiffReview.js";
import { AssistantParts } from "./AssistantParts.js";
import { TurnToolTrace } from "./parts/TurnToolTrace.js";
import { UserMessage } from "./UserMessage.js";

export function SessionTurn({ turn }: { turn: TimelineTurn }) {
  const visibleParts = turn.assistantParts.filter((part) => part.kind !== "tool");
  return (
    <article className="turn">
      <UserMessage message={turn.userMessage} />
      <TurnToolTrace turn={turn} />
      <AssistantParts parts={visibleParts} />
      {turn.mutationDiffs.length > 0 ? (
        <TurnDiffReview files={turn.mutationDiffs} />
      ) : null}
    </article>
  );
}
