import React from "react";
import type { TimelineTurn } from "../../state/types.js";
import { TurnDiffReview } from "../review/TurnDiffReview.js";
import { AssistantParts } from "./AssistantParts.js";
import { UserMessage } from "./UserMessage.js";

export function SessionTurn({ turn }: { turn: TimelineTurn }) {
  return (
    <article className="turn">
      <UserMessage message={turn.userMessage} />
      <AssistantParts parts={turn.assistantParts} turnCompleted={turn.completed} />
      {turn.mutationDiffs.length > 0 ? (
        <TurnDiffReview files={turn.mutationDiffs} />
      ) : null}
    </article>
  );
}
