import React from "react";
import type { TimelineTurn } from "../../state/types.js";
import { SessionTurn } from "./SessionTurn.js";

export function MessageTimeline({
  turns,
  empty,
  timelineRef,
}: {
  turns: TimelineTurn[];
  empty?: React.ReactNode;
  timelineRef?: React.RefObject<HTMLElement | null>;
}) {
  return (
    <section className="timeline" ref={timelineRef as React.RefObject<HTMLElement>}>
      {turns.length === 0 ? (
        empty || (
          <div className="empty">
            <h1>Start working in this project</h1>
            <p>Pick an existing session from the left, or create a new one.</p>
          </div>
        )
      ) : (
        turns.map((turn) => <SessionTurn key={turn.id} turn={turn} />)
      )}
    </section>
  );
}
