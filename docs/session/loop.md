# Session Loop

## Core functions

### runTurn

`runTurn(provider, registry, session, userInput, options) → TurnResult`

Appends the user input as a message, runs the model+tool loop until the model stops emitting tool calls or `maxTurns` is reached, and returns the updated session state plus only the new messages from this turn.

Key behaviors:

- Builds the tool schema list from the registry for each provider call
- Injects the system prompt with the workspace root
- Handles permission checks (allow / ask / deny) for each tool call
- Creates checkpoints before `edit_file` operations
- Accumulates tool results and feeds them back to the model
- Emits `TurnEvent`s via `options.onEvent` for real-time UI feedback

### runSession

`runSession(provider, registry, initialMessages, options) → SessionResult`

Backward-compatible wrapper. Extracts the last user message from `initialMessages`, uses preceding messages as history, delegates to `runTurn`, and returns the full transcript.

## Session state

```ts
type SessionState = {
  id: string;
  cwd: string; // canonical workspace root, not process.cwd()
  messages: Message[];
};
```

The provider and registry are not part of session state — they are passed in by the caller. This keeps the session serializable for persistence.

## Multi-turn flow

In chat mode, the CLI creates a `SessionState` and calls `runTurn` for each user input. The returned session replaces the previous state, and `newMessages` is persisted to the global transcript store. Each turn's messages are appended independently, supporting crash recovery.

## TurnEvent

`TurnEvent` is the real-time observer interface. It decouples the session loop's execution from the CLI's presentation, allowing streaming text, approval prompts, and tool results to appear as they happen — not buffered until the turn ends.

```ts
type TurnEvent =
  | { type: "assistant_text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "assistant_message"; message: Message }
  | {
      type: "tool_approval_required";
      id: string;
      name: string;
      input: unknown;
      reason: string;
    }
  | {
      type: "tool_approval_decision";
      id: string;
      name: string;
      decision: "allow" | "deny";
    }
  | { type: "tool_started"; id: string; name: string; input: unknown }
  | { type: "tool_result"; message: Message }
  | { type: "turn_finished" };
```

### Emission order

Within a single model → tool → model cycle:

1. `assistant_text_delta` — each text chunk from the provider stream
2. `tool_call` — each tool call received during streaming
3. `assistant_message` — the complete assistant message (text + tool calls)
4. For each tool call:
   - `tool_approval_required` — if permission is "ask" and an approvalHandler exists
   - `tool_approval_decision` — after the handler resolves
   - `tool_started` — immediately before tool execution (only if approved)
   - `tool_result` — the tool result or blocked message
5. `turn_finished` — after all turns complete

### Message vs TurnEvent

- **`Message`** is the persistence structure. It's what gets stored in the transcript and survives across sessions.
- **`TurnEvent`** is the real-time observation structure. It's ephemeral — for the CLI/UI to react during execution.

The `onEvent` callback is optional. When not provided, the loop runs identically but without streaming output. This keeps tests and non-interactive usage simple.

### Approval

Approval is a runtime decision point. When a tool call's permission check returns "ask":

1. If no `approvalHandler` is provided: the tool is not executed, a `tool_result` with a blocked message is emitted and persisted.
2. If an `approvalHandler` is provided: `tool_approval_required` is emitted with the tool name, reason, and input. The handler decides allow/deny. `tool_approval_decision` is emitted with the verdict.

The CLI's approval handler prints the tool info (from the event) and prompts `Approve? [Y/n]`. Empty input or `y`/`yes` grants approval. `n`/`no` denies.

## Persistence

The session loop itself is unaware of SQLite. The CLI (or test harness) is responsible for calling `store.appendMessages()` after each turn. The store is a single global database at `~/.myagent/myagent.sqlite`.

The `TurnEvent` system does not affect persistence — the final `Message[]` is identical whether or not events were observed.
